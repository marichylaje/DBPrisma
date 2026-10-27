// Regresión de seguridad del backend. Sin DB real: Prisma y el rate limit se sustituyen por stubs.
// Ejecutar: npm test
process.env.APP_JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.ADMIN_SECRET = 'test-admin-secret';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// ---- Stubs -------------------------------------------------------------------------------
const calls = [];
const overrides = new Map();

function makeModel(name) {
  return new Proxy({}, {
    get: (_t, method) => async (args) => {
      calls.push({ model: name, method, args });
      const custom = overrides.get(`${name}.${method}`);
      if (custom) return custom(args);
      if (method === 'findMany') return [];
      if (method === 'deleteMany' || method === 'updateMany') return { count: 0 };
      if (method === 'findFirst' || method === 'findUnique') return null;
      return (args && args.data) || {};
    },
  });
}

const prismaStub = new Proxy({}, {
  get: (_t, name) => {
    if (name === '$queryRaw') return async () => [];
    if (name === '$transaction') return async (fn) => (typeof fn === 'function' ? fn(prismaStub) : Promise.all(fn));
    return makeModel(String(name));
  },
});

function stubModule(relPath, exports) {
  const filename = require.resolve(path.join(root, relPath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

stubModule('lib/prisma.js', { prisma: prismaStub });
stubModule('lib/rateLimit.js', {
  checkRateLimit: async () => true,
  checkRateLimitTiers: async () => true,
  checkWriteRateLimit: async () => true,
  getClientIp: () => '1.2.3.4',
  isFailureLocked: async () => false,
  recordFailure: async () => {},
});

const auth = require(path.join(root, 'lib/auth.js'));

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end() { return this; },
  };
}

async function run(handlerPath, { method = 'GET', headers = {}, query = {}, body } = {}) {
  const handler = require(path.join(root, handlerPath));
  const res = mockRes();
  await handler({ method, headers, query, body, socket: {} }, res);
  return res;
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const deviceA = auth.issueDeviceToken('dev_AAAA');
const deviceB = auth.issueDeviceToken('dev_BBBB');
const userToken = auth.issueUserToken({ id: 'auth_user1', role: 'player', nickname: 'ana' });

test.beforeEach(() => { calls.length = 0; overrides.clear(); });

// ---- Autenticación -----------------------------------------------------------------------
test('rutas de datos exigen token (sin token → 401)', async () => {
  for (const [file, method] of [
    ['api/decks/list.js', 'GET'],
    ['api/decks/save.js', 'POST'],
    ['api/collection/get.js', 'GET'],
    ['api/wishlist/save.js', 'POST'],
    ['api/entitlement.js', 'GET'],
    ['api/trial/start.js', 'POST'],
    ['api/iap/verify.js', 'POST'],
    ['api/alldecks/save.js', 'POST'],
  ]) {
    const res = await run(file, { method, body: {} });
    assert.equal(res.statusCode, 401, `${file} debía devolver 401`);
  }
});

test('el secreto antiguo x-app-secret ya no abre ninguna ruta de datos', async () => {
  const res = await run('api/decks/list.js', { headers: { 'x-app-secret': 'test-admin-secret' } });
  assert.equal(res.statusCode, 401);
});

test('token falsificado o con otra clave → 401', async () => {
  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ sub: 'victim', kind: 'user' }, 'otra-clave-otra-clave-otra-clave-12345', {
    algorithm: 'HS256', issuer: 'mtg-deckbuilder-api', audience: 'mtg-deckbuilder-app',
  });
  const res = await run('api/decks/list.js', { headers: bearer(forged) });
  assert.equal(res.statusCode, 401);
});

test('un token de dispositivo no sirve en rutas de cuenta', async () => {
  const res = await run('api/friends/list.js', { headers: bearer(deviceA) });
  assert.equal(res.statusCode, 403);
});

test('admin: un token de usuario/dispositivo no sirve; ADMIN_SECRET y CRON_SECRET sí pasan', async () => {
  for (const file of ['api/admin/refresh-prices.js', 'api/admin/reverify-pending.js', 'api/admin/reconcile-subscriptions.js']) {
    const denied = await run(file, { method: 'POST', headers: bearer(userToken) });
    assert.equal(denied.statusCode, 401, `${file} debía rechazar un JWT de usuario`);
  }
  const wrongHeader = await run('api/admin/cleanup.js', { headers: { 'x-app-secret': 'otro' } });
  assert.equal(wrongHeader.statusCode, 401);
  const okAdmin = await run('api/admin/cleanup.js', { headers: { 'x-app-secret': 'test-admin-secret' } });
  assert.equal(okAdmin.statusCode, 200);
  const okCron = await run('api/admin/cleanup.js', { headers: bearer('test-cron-secret') });
  assert.equal(okCron.statusCode, 200);
});

// ---- Aislamiento entre usuarios (IDOR) ---------------------------------------------------
test('decks/list ignora el userKey del cliente y filtra por el dueño del token', async () => {
  await run('api/decks/list.js', { headers: bearer(deviceA), query: { userKey: 'dev_BBBB' } });
  const call = calls.find((c) => c.model === 'userDeck' && c.method === 'findMany');
  assert.deepEqual(call.args.where, { userKey: 'dev_AAAA' });
});

test('collection/wishlist leen solo los datos del dueño del token', async () => {
  await run('api/collection/get.js', { headers: bearer(deviceA), query: { userKey: 'dev_BBBB' } });
  await run('api/wishlist/get.js', { headers: bearer(deviceA), query: { userKey: 'dev_BBBB' } });
  assert.equal(calls.find((c) => c.model === 'userCollection').args.where.userKey, 'dev_AAAA');
  assert.equal(calls.find((c) => c.model === 'userWishlist').args.where.userKey, 'dev_AAAA');
});

test('decks/save no puede actualizar el deck de otro (deckId ajeno → 404)', async () => {
  const res = await run('api/decks/save.js', {
    method: 'POST',
    headers: bearer(deviceB),
    body: { deckName: 'x', commanderName: 'Atraxa', deckId: 'deck_de_A', userKey: 'dev_AAAA', cards: [] },
  });
  assert.equal(res.statusCode, 404);
  const lookup = calls.find((c) => c.model === 'userDeck' && c.method === 'findFirst');
  assert.deepEqual(lookup.args.where, { id: 'deck_de_A', userKey: 'dev_BBBB' });
  assert.equal(calls.some((c) => c.method === 'update'), false);
});

test('decks/delete y patch limitan por dueño', async () => {
  await run('api/decks/delete.js', { method: 'POST', headers: bearer(deviceB), body: { id: 'deck_de_A' } });
  const del = calls.find((c) => c.model === 'userDeck' && c.method === 'deleteMany');
  assert.equal(del.args.where.userKey, 'dev_BBBB');

  const res = await run('api/decks/patch.js', { method: 'POST', headers: bearer(deviceB), body: { id: 'deck_de_A', instagram: 'x' } });
  assert.equal(res.statusCode, 404);
});

test('migrate-user-data exige un token de dispositivo firmado (no acepta un userKey en el body)', async () => {
  const spoof = await run('api/auth-sync/migrate-user-data.js', {
    method: 'POST', headers: bearer(userToken), body: { userKey: 'dev_AAAA', userId: 'auth_user1' },
  });
  assert.equal(spoof.statusCode, 400);
  assert.equal(calls.some((c) => c.method === 'updateMany'), false);
});

// ---- Validación --------------------------------------------------------------------------
test('registro: valida email y contraseña mínima de 8', async () => {
  const weak = await run('api/auth-register.js', { method: 'POST', body: { username: 'bob', email: 'bob@x.com', password: '123' } });
  assert.equal(weak.statusCode, 400);
  const badEmail = await run('api/auth-register.js', { method: 'POST', body: { username: 'bob', email: 'nope', password: '12345678' } });
  assert.equal(badEmail.statusCode, 400);
});

test('payloads desmesurados se rechazan (cards > 500)', async () => {
  const res = await run('api/decks/save.js', {
    method: 'POST', headers: bearer(deviceA),
    body: { deckName: 'x', commanderName: 'A', cards: new Array(501).fill({ name: 'c', count: 1 }) },
  });
  assert.equal(res.statusCode, 400);
});

// ---- Fugas de información ----------------------------------------------------------------
test('los errores 500 no devuelven el mensaje interno', async () => {
  overrides.set('userDeck.findMany', () => { throw new Error('SECRETO: connection string postgres://...'); });
  const res = await run('api/decks/list.js', { headers: bearer(deviceA) });
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes('SECRETO'), false);
  assert.equal(res.body.details, undefined);
});

test('tournaments/search nunca selecciona email ni passwordHash del usuario', async () => {
  overrides.set('tournament.findUnique', () => ({ id: 't1', storeId: 'store1', admins: [], participants: [], matches: [] }));
  await run('api/tournaments/search.js', { query: { id: 't1' } });
  const call = calls.find((c) => c.model === 'tournament' && c.method === 'findUnique');
  const select = call.args.include.participants.include.user.select;
  assert.ok(select, 'debe usar select explícito');
  assert.equal(select.passwordHash, undefined);
  assert.equal(select.email, undefined);
});

test('tournaments/search oculta decklist y pagos a quien no es organizador', async () => {
  overrides.set('tournament.findUnique', () => ({
    id: 't1', storeId: 'store1', admins: [], matches: [],
    participants: [{ id: 'p1', userId: 'u1', deckSnapshot: { a: 1 }, paymentStatus: 'Paid', paymentMethod: 'cash', decklistUrl: 'http://x', matchPoints: 3 }],
  }));
  const res = await run('api/tournaments/search.js', { query: { id: 't1' }, headers: bearer(userToken) });
  const p = res.body.tournaments[0].participants[0];
  assert.equal(p.deckSnapshot, undefined);
  assert.equal(p.paymentMethod, undefined);
  assert.equal(p.matchPoints, 3);

  const organizer = auth.issueUserToken({ id: 'store1', role: 'store', nickname: 'tienda' });
  const org = await run('api/tournaments/search.js', { query: { id: 't1' }, headers: bearer(organizer) });
  assert.deepEqual(org.body.tournaments[0].participants[0].deckSnapshot, { a: 1 });
});

// ---- Sesión de dispositivo ---------------------------------------------------------------
test('auth-device emite un userKey generado por el servidor y un JWT válido', async () => {
  const res = await run('api/auth-device.js', { method: 'POST' });
  assert.equal(res.statusCode, 201);
  assert.match(res.body.userKey, /^dev_[0-9a-f]{32}$/);
  const decoded = auth.decodeVerifiedToken(res.body.token);
  assert.equal(decoded.kind, 'device');
  assert.equal(decoded.sub, res.body.userKey);
});

// ---- IAP ---------------------------------------------------------------------------------
test('el bypass DISABLE_ANDROID_VERIFY no concede premium en producción', async () => {
  process.env.VERCEL_ENV = 'production';
  process.env.DISABLE_ANDROID_VERIFY = 'true';
  process.env.ALLOW_PENDING_ANDROID_PREMIUM = 'true';
  let upserted = false;
  overrides.set('userEntitlement.upsert', () => { upserted = true; return {}; });
  // Sin el bypass se intenta verificar contra Google; sin credenciales falla y NO se concede acceso.
  const res = await run('api/iap/verify.js', {
    method: 'POST', headers: bearer(deviceA),
    body: { platform: 'android', productId: 'premium_support_5', purchaseToken: 'token-falso' },
  });
  delete process.env.VERCEL_ENV;
  delete process.env.DISABLE_ANDROID_VERIFY;
  delete process.env.ALLOW_PENDING_ANDROID_PREMIUM;
  assert.notEqual(res.statusCode, 200);
  assert.equal(upserted, false);
});

test('iap/verify: Android SKU válida pasa allowlist', async () => {
  process.env.DISABLE_ANDROID_VERIFY = 'true';
  process.env.ALLOW_PENDING_ANDROID_PREMIUM = 'true';
  let upsertArgs = null;
  overrides.set('userEntitlement.upsert', (args) => { upsertArgs = args; return {}; });

  const res = await run('api/iap/verify.js', {
    method: 'POST',
    headers: bearer(deviceA),
    body: { platform: 'android', productId: 'premium_support_8', purchaseToken: 'token-valido-test' },
  });

  delete process.env.DISABLE_ANDROID_VERIFY;
  delete process.env.ALLOW_PENDING_ANDROID_PREMIUM;

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.pending, true);
  assert.equal(upsertArgs.create.subProductId, 'premium_support_8');
});

test('iap/verify: Android SKU inválida se rechaza con 400 invalid_product_id', async () => {
  process.env.DISABLE_ANDROID_VERIFY = 'true';
  process.env.ALLOW_PENDING_ANDROID_PREMIUM = 'true';
  let upserted = false;
  overrides.set('userEntitlement.upsert', () => { upserted = true; return {}; });

  const res = await run('api/iap/verify.js', {
    method: 'POST',
    headers: bearer(deviceA),
    body: { platform: 'android', productId: 'premium_support_fake', purchaseToken: 'token-falso-test' },
  });

  delete process.env.DISABLE_ANDROID_VERIFY;
  delete process.env.ALLOW_PENDING_ANDROID_PREMIUM;

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid_product_id' });
  assert.equal(upserted, false);
});

test('iap/verify: iOS productId fuera de allowlist no activa premium', async () => {
  const verifyPath = path.join(root, 'api/iap/verify.js');
  const verifyKey = require.resolve(verifyPath);
  const appleModuleKey = require.resolve(path.join(root, 'lib/iap-apple.js'));
  const oldVerifyModule = require.cache[verifyKey];
  const oldAppleModule = require.cache[appleModuleKey];

  delete require.cache[verifyKey];
  require.cache[appleModuleKey] = {
    id: appleModuleKey,
    filename: appleModuleKey,
    loaded: true,
    exports: {
      verifyAppleReceipt: async () => ({
        active: true,
        expiryMs: Date.now() + 60_000,
        productId: 'premium.support.999',
        originalTransactionId: 'otx-test-allowlist',
      }),
    },
    children: [],
    paths: [],
  };

  let upsertArgs = null;
  overrides.set('userEntitlement.upsert', (args) => { upsertArgs = args; return {}; });

  const res = mockRes();
  try {
    const handler = require(verifyPath);
    await handler({
      method: 'POST',
      headers: bearer(deviceA),
      body: { platform: 'ios', receipt: 'dummy-receipt-base64' },
      socket: {},
    }, res);
  } finally {
    if (oldVerifyModule) require.cache[verifyKey] = oldVerifyModule;
    else delete require.cache[verifyKey];
    if (oldAppleModule) require.cache[appleModuleKey] = oldAppleModule;
    else delete require.cache[appleModuleKey];
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { active: false, expiryMs: null, pending: false });
  assert.equal(upsertArgs.create.subActive, false);
  assert.equal(upsertArgs.create.subProductId, 'premium.support.999');
});
