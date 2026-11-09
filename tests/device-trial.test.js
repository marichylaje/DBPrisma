process.env.APP_JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entitlements = new Map();
const devices = new Map();
const users = new Map();
const links = new Map();
let transactionAttempts = 0;
let conflicts = 0;
let queue = Promise.resolve();

function withShared(ent) {
  return ent ? { ...ent, sharedTrial: entitlements.get(ent.sharedTrialKey) ?? null } : null;
}

const tx = {
  userEntitlement: {
    findUnique: async ({ where }) => withShared(entitlements.get(where.userKey)),
    upsert: async ({ where, create, update }) => {
      const previous = entitlements.get(where.userKey);
      const ent = previous
        ? { ...previous, ...update }
        : { trialGranted: false, sharedTrialKey: null, trialStart: null, trialExpiry: null, ...create };
      entitlements.set(where.userKey, ent);
      return { ...ent };
    },
  },
  uniqueDevice: {
    findUnique: async ({ where }) => {
      const device = devices.get(where.id);
      return device ? { ...device, trialOwner: entitlements.get(device.trialOwnerKey) ?? null } : null;
    },
    update: async ({ where, data }) => {
      const device = { ...devices.get(where.id), ...data };
      devices.set(where.id, device);
      return device;
    },
    upsert: async ({ where, create }) => {
      const existing = [...devices.values()].find((device) => device.identityHash === where.identityHash);
      if (existing) return existing;
      const device = { id: `device_${devices.size + 1}`, trialOwnerKey: null, ...create };
      devices.set(device.id, device);
      return device;
    },
  },
  user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
  uniqueDeviceUser: {
    upsert: async ({ create }) => {
      links.set(`${create.deviceId}:${create.userId}`, create);
      return create;
    },
  },
};

const prisma = {
  ...tx,
  $transaction: async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    transactionAttempts += 1;
    if (conflicts-- > 0) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await work(tx); } finally { release(); }
  },
};
function stub(rel, exports) {
  const filename = require.resolve(path.join(root, rel));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub('lib/prisma.js', { prisma });
stub('lib/rateLimit.js', { checkRateLimitTiers: async () => true });
const auth = require('../lib/auth');
const { resolveDeviceTrial } = require('../lib/deviceTrial');

function owner(id) {
  users.set(id, { id, nickname: id });
  return { userKey: id, userId: id, kind: 'user' };
}
function device(id) {
  devices.set(id, { id, trialOwnerKey: null });
  return id;
}
function grant(id, expiry, start = Date.now() - 86400000) {
  const ent = { userKey: id, trialGranted: true, trialStart: new Date(start),
    trialExpiry: expiry === null ? null : new Date(expiry), sharedTrialKey: null };
  entitlements.set(id, ent);
  return ent;
}
async function run(file, { method = 'GET', headers = {}, body } = {}) {
  const res = {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    end() { return this; },
  };
  await require(path.join(root, file))({ method, headers, body, query: {} }, res);
  return res;
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test.beforeEach(() => {
  entitlements.clear(); devices.clear(); users.clear(); links.clear();
  transactionAttempts = 0; conflicts = 0; queue = Promise.resolve();
  delete process.env.TRIAL_DAYS;
});

test('one device shares one expiry across new accounts without sharing subscriptions', async () => {
  const d = device('d1');
  const first = await resolveDeviceTrial(owner('a'), d, { start: true });
  const expiry = first.trial.expiryMs;
  assert.equal(first.trial.alreadyGranted, false);
  assert.ok(expiry > Date.now() + 14 * 86400000);
  entitlements.get('a').subActive = true;
  const second = await resolveDeviceTrial(owner('b'), d, { start: true });
  assert.equal(second.trial.expiryMs, expiry);
  assert.equal(second.trial.alreadyGranted, true);
  assert.equal(second.entitlement.sharedTrialKey, 'a');
  assert.equal(second.entitlement.subActive, undefined);
  assert.equal(links.size, 2);
});

test('expired device cannot grant a fresh trial to another account or anonymous session', async () => {
  grant('a', Date.now() - 1000);
  devices.set('d1', { id: 'd1', trialOwnerKey: 'a' });
  const second = await resolveDeviceTrial(owner('b'), 'd1', { start: true });
  assert.equal(second.trial.active, false);
  assert.equal(second.trial.canStartTrial, false);
  const anonymous = await resolveDeviceTrial(
    { userKey: 'dev_new', userId: null, kind: 'device' }, 'd1', { start: true },
  );
  assert.equal(anonymous.trial.expiryMs, second.trial.expiryMs);
  assert.equal(anonymous.trial.active, false);
});

test('used account cannot reset its trial on a fresh device', async () => {
  const expiry = Date.now() - 1000;
  grant('a', expiry);
  const result = await resolveDeviceTrial(owner('a'), device('new'), { start: true });
  assert.equal(result.trial.expiryMs, expiry);
  assert.equal(result.trial.active, false);
  assert.equal(devices.get('new').trialOwnerKey, 'a');
});

test('two previously used identities are constrained by the earlier expiry', async () => {
  grant('a', Date.now() + 10000);
  grant('b', Date.now() - 1000);
  devices.set('d1', { id: 'd1', trialOwnerKey: 'b' });
  const result = await resolveDeviceTrial(owner('a'), 'd1', { start: true });
  assert.equal(result.trial.active, false);
  assert.equal(result.trial.expiryMs, entitlements.get('b').trialExpiry.getTime());
  assert.equal(entitlements.get('a').sharedTrialKey, null);
});

test('database edits to the original grant propagate to linked accounts and devices', async () => {
  await resolveDeviceTrial(owner('a'), device('d1'), { start: true });
  await resolveDeviceTrial(owner('b'), 'd1', { start: true });
  const extended = Date.now() + 30 * 86400000;
  entitlements.get('a').trialExpiry = new Date(extended);
  const result = await resolveDeviceTrial(owner('b'), 'd1');
  assert.equal(result.trial.expiryMs, extended);
});

test('legacy granted trials are adopted without restarting or assuming missing dates', async () => {
  const expiry = Date.now() + 123456;
  grant('a', expiry);
  const adopted = await resolveDeviceTrial(owner('a'), device('d1'));
  assert.equal(adopted.trial.expiryMs, expiry);
  grant('b', null);
  const invalid = await resolveDeviceTrial(owner('b'), device('d2'), { start: true });
  assert.equal(invalid.trial.trialGranted, true);
  assert.equal(invalid.trial.active, false);
  assert.equal(invalid.trial.expiryMs, null);
});

test('trial history survives account removal and prevents trials on replacement accounts', async () => {
  await resolveDeviceTrial(owner('a'), device('d1'), { start: true });
  const expiry = entitlements.get('a').trialExpiry.getTime();
  users.delete('a');
  const result = await resolveDeviceTrial(owner('replacement'), 'd1', { start: true });
  assert.equal(result.trial.expiryMs, expiry);
});

test('serializable conflicts retry and simultaneous starts converge on one grant', async () => {
  device('d1');
  conflicts = 2;
  const [first, second] = await Promise.all([
    resolveDeviceTrial(owner('a'), 'd1', { start: true }),
    resolveDeviceTrial(owner('b'), 'd1', { start: true }),
  ]);
  assert.equal(first.trial.expiryMs, second.trial.expiryMs);
  assert.equal([...entitlements.values()].filter((ent) => !ent.sharedTrialKey).length, 1);
  assert.ok(transactionAttempts >= 4);
});

test('database failures and invalid trial configuration are not swallowed', async () => {
  conflicts = 10;
  await assert.rejects(resolveDeviceTrial(owner('a'), device('d1')), { code: 'P2034' });
  conflicts = 0;
  process.env.TRIAL_DAYS = 'invalid';
  await assert.rejects(resolveDeviceTrial(owner('a'), 'd1', { start: true }), /invalid_trial_days/);
});

test('new grants require a signed mobile device; legacy sessions can still read existing access', async () => {
  const account = owner('a');
  const token = auth.issueUserToken({ id: account.userId, role: 'player' });
  const start = await run('api/trial/start.js', { method: 'POST', headers: bearer(token) });
  assert.equal(start.statusCode, 428);
  assert.equal(entitlements.size, 0);
  const status = await run('api/trial/status.js', { headers: bearer(token) });
  assert.equal(status.body.canStartTrial, false);
  grant('a', Date.now() + 86400000);
  const ent = await run('api/entitlement.js', { headers: bearer(token) });
  assert.equal(ent.body.source, 'trial');
  assert.equal(ent.headers['Cache-Control'], 'no-store');
});

test('forged device proof and anonymous proof belonging to a different owner are rejected', async () => {
  device('d1');
  const anonymous = auth.issueDeviceToken('dev_a', 'd1');
  const mismatched = auth.issueDeviceToken('dev_b', 'd1');
  for (const proof of ['forged', mismatched]) {
    const response = await run('api/entitlement.js', {
      headers: { ...bearer(anonymous), 'x-device-token': proof },
    });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(transactionAttempts, 0);
});

test('enrollment reuses the trial identity but never recovers another anonymous data owner', async () => {
  const body = { platform: 'android', deviceIdentity: 'abcdef1234567890' };
  const first = await run('api/auth-device.js', { method: 'POST', body });
  const second = await run('api/auth-device.js', { method: 'POST', body });
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.deviceId, second.body.deviceId);
  assert.notEqual(first.body.userKey, second.body.userKey);
  const stored = devices.get(first.body.deviceId);
  assert.match(stored.identityHash, /^[0-9a-f]{64}$/);
  assert.equal(stored.deviceIdentity, undefined);
  assert.equal(auth.decodeVerifiedToken(first.body.token).deviceId, first.body.deviceId);
});

test('upgrade preserves legacy anonymous data identity and adopts its existing trial', async () => {
  const previousToken = auth.issueDeviceToken('dev_legacy');
  const expiry = Date.now() + 123456;
  grant('dev_legacy', expiry);
  const response = await run('api/auth-device.js', {
    method: 'POST',
    body: { platform: 'ios', deviceIdentity: '11111111-aaaa-bbbb-cccc-222222222222', previousToken },
  });
  assert.equal(response.body.userKey, 'dev_legacy');
  assert.equal(devices.get(response.body.deviceId).trialOwnerKey, 'dev_legacy');
  const result = await resolveDeviceTrial(owner('new_account'), response.body.deviceId);
  assert.equal(result.trial.expiryMs, expiry);
});

test('invalid enrollment does not create an identity', async () => {
  for (const body of [
    { platform: 'web', deviceIdentity: 'abcdef1234567890' },
    { platform: 'android', deviceIdentity: '0000000000000000' },
    { platform: 'ios', deviceIdentity: 'abcdef1234567890', previousToken: 'forged' },
  ]) {
    const response = await run('api/auth-device.js', { method: 'POST', body });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(devices.size, 0);
});
