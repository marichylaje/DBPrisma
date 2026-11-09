const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { generateDeviceKey, issueDeviceToken, decodeVerifiedToken } = require('../lib/auth');
const { prisma } = require('../lib/prisma');
const { getJsonBody } = require('../lib/requestBody');
const { z } = require('zod');
const crypto = require('crypto');
const { resolveDeviceTrial } = require('../lib/deviceTrial');
const { checkRateLimitTiers } = require('../lib/rateLimit');
const { sendServerError } = require('../lib/httpError');

const devicePayload = z.object({
  platform: z.enum(['android', 'ios']),
  deviceIdentity: z.string().trim().min(8).max(200).regex(/^[a-zA-Z0-9_-]+$/),
  previousToken: z.string().max(4096).optional(),
});

/**
 * POST /api/auth-device
 * Emite una sesión anónima: el servidor genera el userKey (no el cliente) y lo firma en un JWT.
 * Todos los endpoints de datos derivan el dueño de ese token.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    const ok = await checkRateLimitTiers(
      req,
      res,
      'auth-device',
      [
        { id: 'burst', limit: 5, windowSeconds: 10 },
        { id: 'sustained', limit: 30, windowSeconds: 3600 },
      ],
      { failClosed: true },
    );
    if (!ok) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    // Legacy/web sessions still own data, but cannot initiate a new mobile trial.
    if (!body || Object.keys(body).length === 0) {
      const userKey = generateDeviceKey();
      return res.status(201).json({ ok: true, userKey, token: issueDeviceToken(userKey) });
    }
    const parsed = devicePayload.safeParse(body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_device_identity' });
    const { platform, deviceIdentity, previousToken } = parsed.data;
    if (/^0+$/.test(deviceIdentity) || deviceIdentity === 'unknown') {
      return res.status(400).json({ error: 'invalid_device_identity' });
    }
    const previous = previousToken ? decodeVerifiedToken(previousToken) : null;
    if (previousToken && (!previous || previous.kind !== 'device')) {
      return res.status(400).json({ error: 'invalid_device_token' });
    }
    const identityHash = crypto.createHash('sha256')
      .update(`mtg-device-trial-v1:${platform}:${deviceIdentity.toLowerCase()}`).digest('hex');
    const device = await prisma.uniqueDevice.upsert({
      where: { identityHash },
      create: { identityHash, platform },
      update: {},
    });
    if (previous?.deviceId && previous.deviceId !== device.id) {
      return res.status(409).json({ error: 'device_identity_changed' });
    }
    // An untrusted hardware identifier must NEVER recover another anonymous owner's data.
    const userKey = previous ? previous.sub : generateDeviceKey();
    if (previous) {
      await resolveDeviceTrial({ userKey, userId: null, kind: 'device' }, device.id);
    }
    const token = issueDeviceToken(userKey, device.id);
    res.status(201).json({ ok: true, userKey, token, deviceId: device.id });
  } catch (e) {
    sendServerError(res, '/api/auth-device', e);
  }
};
