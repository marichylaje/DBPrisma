const { prisma } = require('./prisma');
const { decodeVerifiedToken, parseBearerToken } = require('./auth');

function readTrialDevice(req, res, owner) {
  const token = req.headers['x-device-token'] ||
    (owner.kind === 'device' ? parseBearerToken(req) : null);
  if (!token) return { deviceId: null };
  const device = decodeVerifiedToken(token);
  if (!device || device.kind !== 'device' ||
      (owner.kind === 'device' && device.sub !== owner.userKey)) {
    res.status(401).json({ error: 'invalid_device_token' });
    return null;
  }
  return { deviceId: device.deviceId };
}

async function serializable(work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt >= 3 || !['P2034', 'P2002'].includes(error?.code)) throw error;
    }
  }
}

function canonical(entitlement) {
  if (!entitlement?.trialGranted) return null;
  if (!entitlement.sharedTrialKey) return entitlement;
  const grant = entitlement.sharedTrial;
  if (!grant || grant.sharedTrialKey || !grant.trialGranted) {
    throw new Error('invalid_shared_trial');
  }
  return grant;
}

function toTrial(grants, now) {
  const granted = grants.length > 0;
  // If a used account meets a used device, neither can extend the other's window.
  const expiryMs = granted && grants.every((grant) => grant.trialExpiry)
    ? Math.min(...grants.map((grant) => grant.trialExpiry.getTime()))
    : null;
  const starts = grants.filter((grant) => grant.trialStart).map((grant) => grant.trialStart.getTime());
  return {
    trialGranted: granted,
    active: expiryMs !== null && expiryMs > now,
    startMs: starts.length ? Math.min(...starts) : null,
    expiryMs,
  };
}

async function resolveDeviceTrial(owner, deviceId, { start = false } = {}) {
  return serializable(async (tx) => {
    let entitlement = await tx.userEntitlement.findUnique({
      where: { userKey: owner.userKey }, include: { sharedTrial: true },
    });
    const device = deviceId
      ? await tx.uniqueDevice.findUnique({
          where: { id: deviceId }, include: { trialOwner: true },
        })
      : null;
    if (deviceId && !device) throw new Error('trial_device_not_found');

    let user = null;
    if (owner.userId && device) {
      user = await tx.user.findUnique({
        where: { id: owner.userId }, select: { id: true, nickname: true },
      });
      if (!user) throw new Error('trial_account_not_found');
      await tx.uniqueDeviceUser.upsert({
        where: { deviceId_userId: { deviceId: device.id, userId: user.id } },
        create: { deviceId: device.id, userId: user.id },
        update: {},
      });
    }
    let accountGrant = canonical(entitlement);
    let deviceGrant = device?.trialOwner ?? null;
    if (deviceGrant?.sharedTrialKey || (deviceGrant && !deviceGrant.trialGranted)) {
      throw new Error('invalid_device_trial');
    }
    const alreadyGranted = !!(accountGrant || deviceGrant);
    const now = Date.now();

    if (!accountGrant && !deviceGrant && start && device) {
      const days = Number(process.env.TRIAL_DAYS ?? 15);
      if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error('invalid_trial_days');
      entitlement = await tx.userEntitlement.upsert({
        where: { userKey: owner.userKey },
        create: {
          userKey: owner.userKey, nickname: user?.nickname ?? null,
          trialGranted: true, trialStart: new Date(now),
          trialExpiry: new Date(now + days * 86400000),
        },
        update: {
          trialGranted: true, trialStart: new Date(now),
          trialExpiry: new Date(now + days * 86400000),
        },
      });
      accountGrant = entitlement;
    }
    if (device && !deviceGrant && accountGrant) {
      await tx.uniqueDevice.update({
        where: { id: device.id }, data: { trialOwnerKey: accountGrant.userKey },
      });
      deviceGrant = accountGrant;
    }
    if (!accountGrant && deviceGrant) {
      entitlement = await tx.userEntitlement.upsert({
        where: { userKey: owner.userKey },
        create: {
          userKey: owner.userKey, nickname: user?.nickname ?? null,
          trialGranted: true, sharedTrialKey: deviceGrant.userKey,
        },
        update: { trialGranted: true, sharedTrialKey: deviceGrant.userKey },
      });
      accountGrant = deviceGrant;
    }

    const grants = [accountGrant, deviceGrant].filter(Boolean);
    return {
      entitlement,
      trial: {
        ...toTrial(grants, now),
        alreadyGranted,
        canStartTrial: !!device && !grants.length,
      },
    };
  });
}

module.exports = { readTrialDevice, resolveDeviceTrial };
