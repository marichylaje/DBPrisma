process.env.APP_JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.AUTH_EMAIL_CODE_SECRET = 'test-email-secret-test-email-secret-1234567890';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.AUTH_EMAIL_FROM = 'MTG DeckBuilder <accounts@example.test>';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

let challenges = new Map();
let users = new Map();
let emails = [];
let deliveryStatus = 200;
let rateAllowed = true;
let transactionQueue = Promise.resolve();
let lockCount = 0;

const keyOf = ({ email, purpose }) => `${email}:${purpose}`;
const matches = (user, where) => {
  if (where.id && user.id !== where.id) return false;
  for (const field of ['email', 'nickname']) {
    if (!where[field]) continue;
    const expected = typeof where[field] === 'string' ? where[field] : where[field].equals;
    if (String(user[field]).toLowerCase() !== expected.toLowerCase()) return false;
  }
  return !where.passwordHash || user.passwordHash !== null;
};
const select = (user, selection) => selection
  ? Object.fromEntries(Object.keys(selection).map((key) => [key, user[key]]))
  : { ...user };

const db = {
  $executeRaw: async () => { lockCount += 1; return 1; },
  authEmailChallenge: {
    findUnique: async ({ where }) => challenges.get(keyOf(where.email_purpose)) || null,
    upsert: async ({ where, create, update }) => {
      const key = keyOf(where.email_purpose);
      const row = challenges.has(key)
        ? { ...challenges.get(key), ...update }
        : { attempts: 0, ...create };
      challenges.set(key, row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = challenges.get(keyOf(where.email_purpose));
      row.attempts += data.attempts.increment;
      return row;
    },
    delete: async ({ where }) => { challenges.delete(keyOf(where.email_purpose)); },
    deleteMany: async ({ where }) => {
      const key = keyOf(where);
      if (challenges.get(key)?.codeHash !== where.codeHash) return { count: 0 };
      challenges.delete(key);
      return { count: 1 };
    },
  },
  user: {
    findFirst: async ({ where, select: selection }) => {
      const user = [...users.values()].find((entry) => matches(entry, where));
      return user ? select(user, selection) : null;
    },
    create: async ({ data, select: selection }) => {
      if ([...users.values()].some((user) => user.email === data.email)) {
        throw Object.assign(new Error('duplicate email'), { code: 'P2002' });
      }
      const user = { createdAt: new Date(), ...data };
      users.set(user.id, user);
      return select(user, selection);
    },
    updateMany: async ({ where, data }) => {
      const user = [...users.values()].find((entry) => matches(entry, where));
      if (!user) return { count: 0 };
      Object.assign(user, data);
      return { count: 1 };
    },
  },
};
db.$transaction = (action) => {
  const result = transactionQueue.then(async () => {
    const oldChallenges = structuredClone(challenges);
    const oldUsers = structuredClone(users);
    try {
      return await action(db);
    } catch (error) {
      challenges = oldChallenges;
      users = oldUsers;
      throw error;
    }
  });
  transactionQueue = result.then(() => undefined, () => undefined);
  return result;
};

function stubModule(file, exports) {
  const filename = require.resolve(path.join(root, file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stubModule('lib/prisma.js', { prisma: db });
stubModule('lib/rateLimit.js', {
  checkRateLimit: async (_req, res, options) => {
    assert.equal(options.failClosed, true);
    assert.equal(options.limit, 5);
    assert.equal(options.windowSeconds, 3600);
    assert.match(options.identity, /^[a-f0-9]{64}$/);
    if (!rateAllowed) res.status(429).json({ error: 'rate_limited' });
    return rateAllowed;
  },
  checkRateLimitTiers: async (_req, res, _name, _tiers, options) => {
    assert.equal(options.failClosed, true);
    if (!rateAllowed) res.status(429).json({ error: 'rate_limited' });
    return rateAllowed;
  },
  getClientIp: () => '127.0.0.1',
  isFailureLocked: async () => false,
  recordFailure: async () => {},
});
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  emails.push(JSON.parse(options.body));
  return { ok: deliveryStatus === 200, status: deliveryStatus };
};
const { requestEmailCode, withVerifiedEmailCode } = require('../lib/authEmail');
const { hashPassword, verifyPassword } = require('../lib/password');
const { decodeVerifiedToken, issueUserToken, issueDeviceToken } = require('../lib/auth');
const email = 'player@example.test';
const codeFromLastEmail = () => emails.at(-1).text.match(/\d{6}/)[0];

async function run(file, body, method = 'POST', token) {
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    end() { return this; },
  };
  await require(path.join(root, 'api', file))({
    method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, socket: {},
  }, res);
  return res;
}
async function existingUser() {
  const user = { id: 'auth_existing', nickname: 'player', email, passwordHash: await hashPassword('old-password'), role: 'player', xp: 0, level: 1, createdAt: new Date() };
  users.set(user.id, user);
  return user;
}

test.beforeEach(() => {
  challenges = new Map();
  users = new Map();
  emails = [];
  deliveryStatus = 200;
  rateAllowed = true;
  lockCount = 0;
});
test.after(() => { global.fetch = originalFetch; });

test('registration sends a 6-digit code, stores only HMAC, binds purpose/email and expires in 10 minutes', async () => {
  await requestEmailCode(email, 'register', 'es');
  const code = codeFromLastEmail();
  assert.match(code, /^\d{6}$/);
  const row = challenges.get(`${email}:register`);
  assert.match(row.codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(row.codeHash, code);
  assert.equal(row.expiresAt - row.sentAt, 600_000);
  assert.match(emails[0].subject, /Verifica/);
  assert.equal(lockCount, 1);
  let called = false;
  const action = async () => { called = true; return true; };
  assert.equal((await withVerifiedEmailCode(email, 'reset', code, action)).error, 'invalid_or_expired_code');
  assert.equal((await withVerifiedEmailCode('different@example.test', 'register', code, action)).error, 'invalid_or_expired_code');
  assert.equal(called, false);
});

test('registration cannot create an account without a code or with an incorrect code', async () => {
  const body = { username: 'player', email, password: 'password-123' };
  assert.equal((await run('auth-register.js', body)).statusCode, 400);
  await requestEmailCode(email, 'register', 'en');
  const wrong = codeFromLastEmail() === '000000' ? '111111' : '000000';
  const rejected = await run('auth-register.js', { ...body, code: wrong });
  assert.equal(rejected.body.error, 'invalid_or_expired_code');
  assert.equal(users.size, 0);
});

test('verified registration creates account with hashed password and JWT, consuming the code', async () => {
  const start = await run('auth-email-code.js', { email: ' PLAYER@EXAMPLE.TEST ', purpose: 'register', language: 'es' });
  assert.deepEqual(start.body, { ok: true, retryAfterSeconds: 60 });
  const result = await run('auth-register.js', { username: ' player ', email, password: 'password-123', code: codeFromLastEmail() });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.emailVerified, true);
  assert.equal(result.body.user.emailVerified, true);
  assert.equal(result.body.user.email, email);
  assert.equal(result.body.user.nickname, 'player');
  assert.equal(result.body.user.passwordHash, undefined);
  assert.equal(decodeVerifiedToken(result.body.token).sub, result.body.user.id);
  const stored = users.get(result.body.user.id);
  assert.ok(stored.emailVerifiedAt instanceof Date);
  assert.ok(await verifyPassword('password-123', stored.passwordHash));
  assert.equal(challenges.size, 0);
});

test('reset sends the same public response for existing, absent and anonymous accounts', async () => {
  await existingUser();
  const found = await run('auth-email-code.js', { email, purpose: 'reset' });
  const absent = await run('auth-email-code.js', { email: 'absent@example.test', purpose: 'reset' });
  users.set('dev_anon', { id: 'dev_anon', email: 'anon@example.test', passwordHash: null });
  const anonymous = await run('auth-email-code.js', { email: 'anon@example.test', purpose: 'reset' });
  assert.deepEqual(found.body, absent.body);
  assert.deepEqual(found.body, anonymous.body);
  assert.equal(emails.length, 1);
  assert.equal(JSON.stringify(found.body).includes(email), false);
});

test('existing login does not require retroactive email verification', async () => {
  await existingUser();
  const result = await run('auth-login.js', { username: 'player', password: 'old-password' });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.emailVerified, false);
  assert.equal(result.body.user.emailVerified, false);
});

test('reset replaces password, verifies email, invalidates old credentials and does not issue a JWT', async () => {
  const user = await existingUser();
  await requestEmailCode(email, 'reset', 'en');
  const code = codeFromLastEmail();
  const result = await run('auth-reset-password.js', { email, code, password: 'new-password' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { ok: true, emailVerified: true });
  assert.ok(await verifyPassword('new-password', user.passwordHash));
  assert.equal(await verifyPassword('old-password', user.passwordHash), false);
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.equal((await run('auth-reset-password.js', { email, code, password: 'other-password' })).body.error, 'invalid_or_expired_code');
  assert.equal((await run('auth-login.js', { username: 'player', password: 'old-password' })).statusCode, 401);
  const loginResult = await run('auth-login.js', { username: 'player', password: 'new-password' });
  assert.equal(loginResult.statusCode, 200);
  assert.equal(loginResult.body.emailVerified, true);
  assert.equal(loginResult.body.user.emailVerified, true);
});

test('code cannot change another account if email was reused after account deletion', async () => {
  const user = await existingUser();
  await requestEmailCode(email, 'reset', 'en');
  users.delete(user.id);
  users.set('replacement', { ...user, id: 'replacement' });
  const result = await run('auth-reset-password.js', { email, code: codeFromLastEmail(), password: 'attacker-password' });
  assert.equal(result.body.error, 'invalid_or_expired_code');
  assert.ok(await verifyPassword('old-password', users.get('replacement').passwordHash));
});

test('fifth failed attempt exhausts the code even if the next code is correct', async () => {
  await requestEmailCode(email, 'register', 'en');
  const code = codeFromLastEmail();
  const wrong = code === '000000' ? '111111' : '000000';
  let actions = 0;
  const action = async () => { actions += 1; return true; };
  for (let n = 0; n < 5; n += 1) {
    assert.equal((await withVerifiedEmailCode(email, 'register', wrong, action)).error, 'invalid_or_expired_code');
  }
  assert.equal(challenges.get(`${email}:register`).attempts, 5);
  assert.equal((await withVerifiedEmailCode(email, 'register', code, action)).error, 'invalid_or_expired_code');
  assert.equal(actions, 0);
});

test('expired code never invokes account mutation', async () => {
  await requestEmailCode(email, 'register', 'en');
  challenges.get(`${email}:register`).expiresAt = new Date(Date.now() - 1);
  const result = await withVerifiedEmailCode(email, 'register', codeFromLastEmail(), async () => assert.fail('must not mutate'));
  assert.equal(result.error, 'invalid_or_expired_code');
});

test('resend is suppressed for 60 seconds, then replaces the old code and resets attempts', async () => {
  await requestEmailCode(email, 'register', 'en');
  const oldHash = challenges.get(`${email}:register`).codeHash;
  await requestEmailCode(email, 'register', 'en');
  assert.equal(emails.length, 1);
  const row = challenges.get(`${email}:register`);
  assert.equal(row.codeHash, oldHash);
  row.sentAt = new Date(Date.now() - 60_001);
  row.attempts = 4;
  await requestEmailCode(email, 'register', 'en');
  assert.equal(emails.length, 2);
  assert.equal(challenges.get(`${email}:register`).attempts, 0);
  assert.equal((await withVerifiedEmailCode(email, 'register', codeFromLastEmail(), async () => true)).value, true);
});

test('concurrent submissions consume one challenge at most once', async () => {
  await requestEmailCode(email, 'register', 'en');
  const code = codeFromLastEmail();
  let actions = 0;
  const results = await Promise.all(Array.from({ length: 3 }, () =>
    withVerifiedEmailCode(email, 'register', code, async () => { actions += 1; return true; })));
  assert.equal(actions, 1);
  assert.equal(results.filter((result) => result.value === true).length, 1);
  assert.equal(lockCount, 4);
});

test('failed account mutation rolls back consumption so a retry can succeed', async () => {
  await requestEmailCode(email, 'register', 'en');
  const code = codeFromLastEmail();
  await assert.rejects(withVerifiedEmailCode(email, 'register', code, async () => { throw new Error('database failure'); }), /database failure/);
  assert.equal(challenges.size, 1);
  assert.equal((await withVerifiedEmailCode(email, 'register', code, async () => true)).value, true);
});

test('registration request for an occupied email sends no code', async () => {
  await existingUser();
  const result = await run('auth-email-code.js', { email, purpose: 'register' });
  assert.equal(result.statusCode, 200);
  assert.equal(emails.length, 0);
});

test('provider failures are explicit and remove the undelivered challenge', async () => {
  deliveryStatus = 503;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const result = await run('auth-email-code.js', { email, purpose: 'register' });
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.error, 'internal_error');
    assert.equal(challenges.size, 0);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});

test('missing email configuration fails before issuing a challenge', async () => {
  const original = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await assert.rejects(requestEmailCode(email, 'register', 'en'), /auth_email_config_invalid/);
    assert.equal(challenges.size, 0);
  } finally {
    process.env.RESEND_API_KEY = original;
  }
});

test('input rejects malformed codes and passwords outside the 8-128 character range', async () => {
  for (const password of ['x'.repeat(7), 'x'.repeat(129)]) {
    assert.equal((await run('auth-reset-password.js', { email, code: '123456', password })).statusCode, 400);
  }
  for (const code of ['12345', '1234567', '12345678', 'abcdef']) {
    assert.equal((await run('auth-reset-password.js', { email, code, password: 'password-123' })).statusCode, 400);
  }
  const { resetPasswordPayload } = require('../lib/validate');
  for (const length of [8, 128]) {
    assert.equal(resetPasswordPayload.safeParse({ email, code: '123456', password: 'x'.repeat(length) }).success, true);
  }
});

test('rate limit prevents delivery and all new endpoints reject GET and malformed JSON', async () => {
  rateAllowed = false;
  assert.equal((await run('auth-email-code.js', { email, purpose: 'register' })).statusCode, 429);
  assert.equal(emails.length, 0);
  rateAllowed = true;
  for (const file of ['auth-email-code.js', 'auth-reset-password.js']) {
    assert.equal((await run(file, {}, 'GET')).statusCode, 405);
    assert.equal((await run(file, '{')).statusCode, 400);
    assert.equal((await run(file, {})).headers['Cache-Control'], 'no-store');
  }
});

test('recipient limiter shares its counter across IPs and fails closed if storage fails', async () => {
  const filename = require.resolve('../lib/rateLimit');
  const originalModule = require.cache[filename];
  const originalQuery = db.$queryRaw;
  const originalLog = console.error;
  const counters = new Map();
  db.$queryRaw = async (_sql, key) => {
    const count = (counters.get(key) || 0) + 1;
    counters.set(key, count);
    return [{ count, windowStart: new Date() }];
  };
  delete require.cache[filename];
  console.error = () => {};
  try {
    const { checkRateLimit } = require('../lib/rateLimit');
    const res = {
      code: 200, body: null,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader() {},
    };
    const options = { name: 'auth-email-recipient', identity: 'hashed-recipient', limit: 5, windowSeconds: 3600, failClosed: true };
    for (let n = 0; n < 5; n += 1) {
      assert.equal(await checkRateLimit({ headers: {}, socket: { remoteAddress: `ip-${n}` } }, res, options), true);
    }
    assert.equal(await checkRateLimit({ headers: {}, socket: { remoteAddress: 'new-ip' } }, res, options), false);
    assert.equal(res.code, 429);
    assert.equal(counters.size, 1);
    db.$queryRaw = async () => { throw new Error('storage unavailable'); };
    assert.equal(await checkRateLimit({ headers: {} }, res, options), false);
    assert.equal(res.code, 503);
    assert.equal(res.body.error, 'service_unavailable');
  } finally {
    require.cache[filename] = originalModule;
    db.$queryRaw = originalQuery;
    console.error = originalLog;
  }
});

test('account verification requires a user session and cannot be invoked through the public sender', async () => {
  assert.equal((await run('auth-verify-email.js', { action: 'send' })).statusCode, 401);
  const device = issueDeviceToken('dev_test');
  assert.equal((await run('auth-verify-email.js', { action: 'send' }, 'POST', device)).statusCode, 403);
  assert.equal((await run('auth-email-code.js', { email, purpose: 'verify' })).statusCode, 400);
  assert.equal(emails.length, 0);
});

test('account verification sends to the session owner, ignores supplied email, and confirms without changing password', async () => {
  const user = await existingUser();
  const token = issueUserToken(user);
  const passwordHash = user.passwordHash;
  const sent = await run('auth-verify-email.js', { action: 'send', language: 'es', email: 'attacker@example.test' }, 'POST', token);
  assert.deepEqual(sent.body, { ok: true, emailVerified: false, retryAfterSeconds: 60 });
  assert.deepEqual(emails[0].to, [email]);
  assert.match(emails[0].subject, /Verifica/);
  const challenge = challenges.get(`${email}:verify`);
  assert.equal(challenge.userId, user.id);
  assert.equal((await run('auth-login.js', { username: 'player', password: 'old-password' })).body.emailVerified, false);
  const code = codeFromLastEmail();
  assert.equal((await run('auth-reset-password.js', { email, code, password: 'must-not-change' })).body.error, 'invalid_or_expired_code');
  const verified = await run('auth-verify-email.js', { action: 'confirm', code }, 'POST', token);
  assert.deepEqual(verified.body, { ok: true, emailVerified: true });
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.equal(user.passwordHash, passwordHash);
  assert.equal(challenges.size, 0);
  assert.equal((await run('auth-login.js', { username: 'player', password: 'old-password' })).body.emailVerified, true);
  const repeated = await run('auth-verify-email.js', { action: 'send' }, 'POST', token);
  assert.equal(repeated.body.emailVerified, true);
  assert.equal(emails.length, 1);
});

test('verification cannot reuse a reset code or verify another account', async () => {
  const user = await existingUser();
  const token = issueUserToken(user);
  await requestEmailCode(email, 'reset', 'en');
  const resetCode = codeFromLastEmail();
  assert.equal((await run('auth-verify-email.js', { action: 'confirm', code: resetCode }, 'POST', token)).body.error, 'invalid_or_expired_code');
  await run('auth-verify-email.js', { action: 'send' }, 'POST', token);
  const verifyCode = codeFromLastEmail();
  const other = { ...user, id: 'other', email: 'other@example.test' };
  users.set(other.id, other);
  const denied = await run('auth-verify-email.js', { action: 'confirm', code: verifyCode, email }, 'POST', issueUserToken(other));
  assert.equal(denied.body.error, 'invalid_or_expired_code');
  assert.equal(user.emailVerifiedAt, undefined);
  assert.equal(other.emailVerifiedAt, undefined);
  assert.equal(challenges.get(`${email}:verify`).userId, user.id);
});

test('wrong verification codes exhaust after five attempts and do not verify the user', async () => {
  const user = await existingUser();
  const token = issueUserToken(user);
  await run('auth-verify-email.js', { action: 'send' }, 'POST', token);
  const code = codeFromLastEmail();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let n = 0; n < 5; n += 1) {
    assert.equal((await run('auth-verify-email.js', { action: 'confirm', code: wrong }, 'POST', token)).body.error, 'invalid_or_expired_code');
  }
  assert.equal((await run('auth-verify-email.js', { action: 'confirm', code }, 'POST', token)).body.error, 'invalid_or_expired_code');
  assert.equal(user.emailVerifiedAt, undefined);
});

test('verification rejects stale account tokens and does not send to missing account email', async () => {
  const user = await existingUser();
  const token = issueUserToken(user);
  users.delete(user.id);
  assert.equal((await run('auth-verify-email.js', { action: 'send' }, 'POST', token)).body.error, 'account_email_unavailable');
  users.set(user.id, { ...user, email: null });
  assert.equal((await run('auth-verify-email.js', { action: 'send' }, 'POST', token)).statusCode, 409);
  assert.equal(emails.length, 0);
});

test('reset code verification does not change credentials or consume code before manual save', async () => {
  const user = await existingUser();
  const originalHash = user.passwordHash;
  await requestEmailCode(email, 'reset', 'en');
  const code = codeFromLastEmail();
  const result = await run('auth-reset-password.js', { action: 'verify', email, code });
  assert.deepEqual(result.body, { ok: true, codeVerified: true });
  assert.equal(user.passwordHash, originalHash);
  assert.equal(user.emailVerifiedAt, undefined);
  assert.equal(challenges.size, 1);
  const saved = await run('auth-reset-password.js', { email, code, password: 'new-password' });
  assert.equal(saved.body.ok, true);
  assert.ok(await verifyPassword('new-password', user.passwordHash));
  assert.equal(challenges.size, 0);
  assert.equal((await run('auth-reset-password.js', { action: 'verify', email, code })).body.error, 'invalid_or_expired_code');
});

test('reset verification rejects wrong codes and save rechecks expiration after verification', async () => {
  const user = await existingUser();
  await requestEmailCode(email, 'reset', 'en');
  const code = codeFromLastEmail();
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await run('auth-reset-password.js', { action: 'verify', email, code: wrong })).body.error, 'invalid_or_expired_code');
  assert.equal(challenges.get(`${email}:reset`).attempts, 1);
  assert.equal((await run('auth-reset-password.js', { action: 'verify', email, code })).body.codeVerified, true);
  challenges.get(`${email}:reset`).expiresAt = new Date(Date.now() - 1);
  assert.equal((await run('auth-reset-password.js', { email, code, password: 'must-not-change' })).body.error, 'invalid_or_expired_code');
  assert.ok(await verifyPassword('old-password', user.passwordHash));
});
