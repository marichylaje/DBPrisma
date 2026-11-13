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
  const challengesCleanup = calls.find((c) => c.model === 'authEmailChallenge' && c.method === 'deleteMany');
  assert.ok(challengesCleanup.args.where.expiresAt.lt instanceof Date);
  assert.equal(okAdmin.body.deleted.authEmailChallenge, 0);
  const okCron = await run('api/admin/cleanup.js', { headers: bearer('test-cron-secret') });
  assert.equal(okCron.statusCode, 200);
});

test('cleanup conserva historiales activos y elimina los inactivos con más de 90 días sin actualizar', async () => {
  overrides.set('userCollection.findMany', () => [
    { cards: ['Atraxa|mom|1', 'Atraxa|mom|1', 'Sol Ring|cmm|2'] },
  ]);
  overrides.set('cardPriceHistory.findMany', () => [
    { cardKey: 'Atraxa|mom|1' },
    { cardKey: 'Old Card|set|3' },
  ]);
  overrides.set('cardPriceHistory.deleteMany', () => ({ count: 1 }));
  const res = await run('api/admin/cleanup.js', {
    headers: bearer('test-cron-secret'),
  });

  assert.equal(res.statusCode, 200);
  const staleLookup = calls.find(
    (call) => call.model === 'cardPriceHistory' && call.method === 'findMany',
  );
  assert.ok(staleLookup.args.where.updatedAt.lt instanceof Date);
  assert.deepEqual(staleLookup.args.select, { cardKey: true });

  const historyDelete = calls.find(
    (call) => call.model === 'cardPriceHistory' && call.method === 'deleteMany',
  );
  assert.deepEqual(historyDelete.args.where.cardKey.in, ['Old Card|set|3']);
  assert.equal(res.body.activePriceCardKeys, 2);
  assert.equal(res.body.deleted.cardPriceHistory, 1);
});

test('refresh-prices omite las cartas ya actualizadas hoy y conserva la detección activa', async () => {
  const now = new Date();
  const todayTimestamp = now.getTime();
  const yesterdayTimestamp = todayTimestamp - 24 * 60 * 60 * 1000;
  const todayKey = 'Today Card|set|1';
  const dueKey = 'Due Card|set|2';
  overrides.set('userCollection.findMany', () => [
    { cards: [todayKey, dueKey] },
  ]);
  overrides.set('cardPriceHistory.findMany', () => [
    { cardKey: todayKey, history: [{ timestamp: todayTimestamp, priceUsd: 1 }] },
    { cardKey: dueKey, history: [{ timestamp: yesterdayTimestamp, priceUsd: 1 }] },
  ]);

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        data: [{
          name: 'Due Card',
          set: 'set',
          collector_number: '2',
          prices: { usd: '2.00', eur: '1.80' },
        }],
      }),
    };
  };

  try {
    const res = await run('api/admin/refresh-prices.js', {
      method: 'POST',
      headers: { 'x-app-secret': 'test-admin-secret' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].identifiers, [{ set: 'set', collector_number: '2' }]);

    const upsert = calls.find(
      (call) => call.model === 'cardPriceHistory' && call.method === 'upsert',
    );
    assert.equal(upsert.args.where.cardKey, dueKey);
    assert.equal(upsert.args.update.lastSeenAt, undefined);
    assert.equal(res.body.skippedCount, 1);
    assert.equal(res.body.updatedCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
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

// Ejecuta api/iap/verify.js con lib/iap-apple-server.js sustituido por un mock.
async function runIosVerifyWithAppleServerMock(appleServerMock, receipt) {
  const verifyPath = path.join(root, 'api/iap/verify.js');
  const verifyKey = require.resolve(verifyPath);
  const serverKey = require.resolve(path.join(root, 'lib/iap-apple-server.js'));
  const realIsSignedTransaction = require(serverKey).isSignedTransaction;
  const oldVerifyModule = require.cache[verifyKey];
  const oldServerModule = require.cache[serverKey];

  delete require.cache[verifyKey];
  require.cache[serverKey] = {
    id: serverKey,
    filename: serverKey,
    loaded: true,
    exports: { ...appleServerMock, isSignedTransaction: realIsSignedTransaction },
    children: [],
    paths: [],
  };

  const res = mockRes();
  try {
    const handler = require(verifyPath);
    await handler({
      method: 'POST',
      headers: bearer(deviceA),
      body: { platform: 'ios', receipt },
      socket: {},
    }, res);
  } finally {
    if (oldVerifyModule) require.cache[verifyKey] = oldVerifyModule;
    else delete require.cache[verifyKey];
    if (oldServerModule) require.cache[serverKey] = oldServerModule;
    else delete require.cache[serverKey];
  }
  return res;
}

const FAKE_JWS = 'aaaa.bbbb.cccc';

test('iap/verify: iOS acepta transacción StoreKit 2 (JWS) verificada y activa premium', async () => {
  let upsertArgs = null;
  overrides.set('userEntitlement.upsert', (args) => { upsertArgs = args; return {}; });
  const expiryMs = Date.now() + 86_400_000;

  const res = await runIosVerifyWithAppleServerMock({
    verifyAppleTransaction: async (jws) => {
      assert.equal(jws, FAKE_JWS);
      return { active: true, expiryMs, productId: 'premium.support.8', originalTransactionId: 'otx-jws-ok' };
    },
  }, FAKE_JWS);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { active: true, expiryMs, pending: false });
  assert.equal(upsertArgs.create.subActive, true);
  assert.equal(upsertArgs.create.appleOriginalTransactionId, 'otx-jws-ok');
});

test('iap/verify: iOS rechaza JWS no confiable con 400 y no concede premium', async () => {
  let upserted = false;
  overrides.set('userEntitlement.upsert', () => { upserted = true; return {}; });

  const res = await runIosVerifyWithAppleServerMock({
    verifyAppleTransaction: async () => {
      const err = new Error('apple_invalid_transaction');
      err.appleCode = 'invalid_transaction';
      throw err;
    },
  }, FAKE_JWS);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid_transaction' });
  assert.equal(upserted, false);
});

test('iap/verify: iOS devuelve 503 si Apple no está disponible para verificar el JWS', async () => {
  let upserted = false;
  overrides.set('userEntitlement.upsert', () => { upserted = true; return {}; });

  const res = await runIosVerifyWithAppleServerMock({
    verifyAppleTransaction: async () => {
      const err = new Error('apple_verification_unavailable');
      err.appleCode = 'verification_unavailable';
      throw err;
    },
  }, FAKE_JWS);

  assert.equal(res.statusCode, 503);
  assert.equal(upserted, false);
});

test('iap/verify: iOS JWS con productId fuera de allowlist no activa premium', async () => {
  let upsertArgs = null;
  overrides.set('userEntitlement.upsert', (args) => { upsertArgs = args; return {}; });

  const res = await runIosVerifyWithAppleServerMock({
    verifyAppleTransaction: async () => ({
      active: true,
      expiryMs: Date.now() + 60_000,
      productId: 'premium.support.999',
      originalTransactionId: 'otx-jws-bad-sku',
    }),
  }, FAKE_JWS);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.active, false);
  assert.equal(upsertArgs.create.subActive, false);
});

test('isSignedTransaction distingue JWS de recibos base64 legacy', () => {
  const { isSignedTransaction } = require(path.join(root, 'lib/iap-apple-server.js'));
  assert.equal(isSignedTransaction('eyJhbGciOiJFUzI1NiJ9.eyJhIjoxfQ.c2ln-_x'), true);
  assert.equal(isSignedTransaction('TUlJVGhRWUpLb1pJaHZjTkFRY0NvSUlUZGpDQ0V6SUNBUUV4'), false);
  assert.equal(isSignedTransaction('a.b'), false);
  assert.equal(isSignedTransaction(undefined), false);
});

// ---- Galer�a AllDecks: listado paginado liviano + detalle bajo demanda ---------------------
test('alldecks/list?view=summary pagina por cursor y no env�a cartas', async () => {
  const mkDeck = (id, cards) => ({
    id, userKey: 'dev_AAAA', userId: null, nickname: 'ana', deckName: `d${id}`,
    commanderName: 'Atraxa', partnerName: null, cards, sideboard: [], cardCount: 100, downloadCount: 3,
  });
  overrides.set('allDeck.findMany', () => [
    mkDeck('a', [{ name: 'Sol Ring', count: 1 }]),
    mkDeck('b', [{ name: 'sol  ring', count: 1 }]),
    mkDeck('c', [{ name: 'Mana Crypt', count: 1 }]),
  ]);
  const res = await run('api/alldecks/list.js', { query: { view: 'summary', limit: '2', cursor: 'z' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decks.length, 2);
  assert.equal(res.body.nextCursor, 'b');
  for (const deck of res.body.decks) {
    assert.equal(deck.cards, undefined);
    assert.equal(deck.sideboard, undefined);
    assert.equal(deck.userId, undefined);
  }
  assert.equal(res.body.decks[0].compositionHash, res.body.decks[1].compositionHash);
  const call = calls.find((c) => c.model === 'allDeck' && c.method === 'findMany');
  assert.equal(call.args.take, 3);
  assert.deepEqual(call.args.cursor, { id: 'z' });
  assert.equal(call.args.skip, 1);
});

test('alldecks/list sin view mantiene el formato legacy con cartas', async () => {
  overrides.set('allDeck.findMany', () => [{
    id: 'a', userKey: 'dev_AAAA', nickname: 'ana', deckName: 'd', commanderName: 'Atraxa',
    cards: [{ name: 'Sol Ring', count: 1 }], sideboard: [], cardCount: 100, downloadCount: 0,
  }]);
  const res = await run('api/alldecks/list.js', { query: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.nextCursor, undefined);
  assert.deepEqual(res.body.decks[0].cards, [{ name: 'Sol Ring', count: 1 }]);
});

test('alldecks/get valida id y devuelve s�lo cartas', async () => {
  const bad = await run('api/alldecks/get.js', { query: {} });
  assert.equal(bad.statusCode, 400);
  const missing = await run('api/alldecks/get.js', { query: { id: 'nope' } });
  assert.equal(missing.statusCode, 404);
  overrides.set('allDeck.findUnique', () => ({ id: 'a', cards: [{ name: 'Sol Ring', count: 1 }], sideboard: null }));
  const ok = await run('api/alldecks/get.js', { query: { id: 'a' } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body.deck, { id: 'a', cards: [{ name: 'Sol Ring', count: 1 }], sideboard: [] });
});
