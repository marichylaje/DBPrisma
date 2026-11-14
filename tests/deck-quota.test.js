process.env.APP_JWT_SECRET = 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modelNames = ['userDeck', 'cloudDeck', 'allDeck', 'userEntitlement', 'user', 'userCollection', 'userWishlist'];
let state;
let revision;
let forcedConflicts;
let attempts;
const calls = [];

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'userKey_deckName') return row.userKey === value.userKey && row.deckName === value.deckName;
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function model(name, store, markWrite = () => { revision += 1; }) {
  const rows = store[name];
  const find = (where) => [...rows.values()].find((row) => matches(row, where));
  return {
    async findMany({ where } = {}) {
      calls.push(`${name}.findMany`);
      return [...rows.values()].filter((row) => matches(row, where)).map((row) => ({ ...row }));
    },
    async findUnique({ where, include }) {
      calls.push(`${name}.findUnique`);
      const row = find(where);
      if (!row) return null;
      return {
        ...row,
        ...(include?.sharedTrial ? {
          sharedTrial: [...rows.values()].find((ent) => ent.userKey === row.sharedTrialKey) ?? null,
        } : {}),
      };
    },
    async findFirst(args) { return this.findUnique(args); },
    async create({ data }) {
      if ([...rows.values()].some((row) => row.userKey === data.userKey && row.deckName === data.deckName)) {
        throw Object.assign(new Error('unique conflict'), { code: 'P2002' });
      }
      const row = { id: `${name}_new_${revision}_${rows.size + 1}`, ...data };
      rows.set(row.id, row);
      markWrite();
      return { ...row };
    },
    async update({ where, data }) {
      const row = find(where);
      assert.ok(row, `${name}: row to update exists`);
      const updated = { ...row, ...data };
      if (name.endsWith('Deck') && [...rows.values()].some((other) =>
        other.id !== row.id && other.userKey === updated.userKey && other.deckName === updated.deckName)) {
        throw Object.assign(new Error('unique conflict'), { code: 'P2002' });
      }
      rows.set(row.id, updated);
      markWrite();
      return { ...updated };
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const [id, row] of rows) {
        if (matches(row, where)) { rows.set(id, { ...row, ...data }); count += 1; }
      }
      if (count) markWrite();
      return { count };
    },
    async deleteMany({ where }) {
      let count = 0;
      for (const [id, row] of rows) {
        if (matches(row, where)) { rows.delete(id); count += 1; }
      }
      if (count) markWrite();
      return { count };
    },
  };
}

const prisma = new Proxy({}, {
  get(_target, name) {
    if (name !== '$transaction') return model(name, state);
    return async (work, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      attempts += 1;
      if (forcedConflicts-- > 0) throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
      const snapshotRevision = revision;
      const snapshot = Object.fromEntries(modelNames.map((key) =>
        [key, new Map([...state[key]].map(([id, row]) => [id, { ...row }]))]));
      let written = false;
      const tx = Object.fromEntries(modelNames.map((key) =>
        [key, model(key, snapshot, () => { written = true; })]));
      const result = await work(tx);
      if (written) {
        if (revision !== snapshotRevision) {
          throw Object.assign(new Error('serialization conflict'), { code: 'P2034' });
        }
        state = snapshot;
        revision += 1;
      }
      return result;
    };
  },
});

function stub(rel, exports) {
  const filename = require.resolve(path.join(root, rel));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stub('lib/prisma.js', { prisma });
stub('lib/rateLimit.js', { checkWriteRateLimit: async () => true });
const auth = require('../lib/auth');
const token = auth.issueUserToken({ id: 'account', nickname: 'test', role: 'player' });
const deviceToken = auth.issueDeviceToken('device');

async function run(route, body, { method = 'POST', authorization = token, query = {} } = {}) {
  const res = {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    end() { return this; },
  };
  await require(path.join(root, 'api', route + '.js'))({
    method, body, query, headers: authorization ? { authorization: `Bearer ${authorization}` } : {},
  }, res);
  return res;
}
const payload = (deckName, extra = {}) => ({
  deckName, commander: { name: 'Test Commander', id: 'commander' }, cards: [], ...extra,
});
function seed(name, count, userKey = 'account', offset = 0) {
  for (let i = 1; i <= count; i++) {
    const id = `${name}_${state[name].size + 1}`;
    state[name].set(id, { id, userKey, deckName: `Deck ${i + offset}` });
  }
}
function entitlement(userKey, extra) {
  state.userEntitlement.set(userKey, { id: userKey, userKey, trialGranted: false, ...extra });
}
async function quota() {
  const res = await run('decks/quota', undefined, { method: 'GET' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  return res.body;
}

test.beforeEach(() => {
  state = Object.fromEntries(modelNames.map((name) => [name, new Map()]));
  state.user.set('account', { id: 'account', nickname: 'test' });
  revision = 0; forcedConflicts = 0; attempts = 0; calls.length = 0;
});

test('quota requires auth, uses JWT owner, and returns names only with a shared 20/50 cap', async () => {
  seed('userDeck', 12); seed('cloudDeck', 15); seed('userDeck', 59, 'victim');
  const denied = await run('decks/quota', undefined, { method: 'GET', authorization: null });
  assert.equal(denied.statusCode, 401);
  const res = await run('decks/quota', undefined, { method: 'GET', query: { userKey: 'victim' } });
  assert.equal(res.body.count, 15);
  assert.equal(res.body.limit, 20);
  assert.deepEqual(Object.keys(res.body).sort(), ['count', 'deckNames', 'limit']);
});

test('Free accepts the 20th unique name, rejects 21st through both save endpoints', async () => {
  seed('userDeck', 10); seed('cloudDeck', 9, 'account', 10);
  assert.equal((await run('decks/save', payload('Deck 20'))).statusCode, 200);
  for (const route of ['decks/save', 'clouddecks/save']) {
    const res = await run(route, payload('Deck 21', { isPaidUser: true, userKey: 'victim' }));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'deck_limit_reached');
    assert.equal(res.body.limit, 20);
    assert.equal(res.body.count, 20);
  }
  assert.equal((await quota()).count, 20);
});

test('Premium accepts 50 and rejects 51, trial and shared trial have the same cap', async () => {
  for (const tier of ['subscription', 'trial', 'shared']) {
    state.userDeck.clear(); state.cloudDeck.clear(); state.userEntitlement.clear();
    const expiry = new Date(Date.now() + 86400000);
    if (tier === 'subscription') entitlement('account', { subActive: true, subExpiry: expiry });
    if (tier === 'trial') entitlement('account', { trialGranted: true, trialExpiry: expiry });
    if (tier === 'shared') {
      entitlement('grant', { trialGranted: true, trialExpiry: expiry });
      entitlement('account', { trialGranted: true, sharedTrialKey: 'grant' });
    }
    seed('userDeck', 49);
    assert.equal((await run('clouddecks/save', payload('Deck 50'))).statusCode, 200);
    assert.equal((await run('decks/save', payload('Deck 51'))).statusCode, 409);
    assert.equal((await quota()).limit, 50);
    assert.equal((await quota()).count, 50);
  }
});

test('expired access returns to 20 without deleting or blocking ordinary edits', async () => {
  entitlement('account', { subActive: true, subExpiry: new Date(Date.now() - 1000),
    trialGranted: true, trialExpiry: new Date(Date.now() - 1000) });
  seed('userDeck', 59);
  calls.length = 0;
  assert.equal((await run('decks/save', payload('Deck 59'))).statusCode, 200);
  assert.equal(calls.includes('userEntitlement.findUnique'), false, 'ordinary edits need no entitlement read');
  assert.equal((await run('clouddecks/save', payload('Deck 59'))).statusCode, 200);
  assert.equal((await run('decks/save', payload('New'))).statusCode, 409);
  assert.equal((await quota()).count, 59);
});

test('duplicate names across tables consume one slot and still allow a missing copy at cap', async () => {
  seed('userDeck', 20);
  assert.equal((await run('clouddecks/save', payload('Deck 20'))).statusCode, 200);
  assert.equal((await quota()).count, 20);
  assert.equal((await run('clouddecks/save', payload('Another name'))).statusCode, 409);
});

test('delete, create replacement, and sync old deck cannot exceed cap', async () => {
  seed('userDeck', 20);
  assert.equal((await run('decks/delete', { deckName: 'Deck 1' })).statusCode, 200);
  assert.equal((await run('decks/save', payload('Replacement'))).statusCode, 200);
  assert.equal((await run('decks/save', payload('Deck 1'))).statusCode, 409);
  assert.equal((await quota()).count, 20);
});

test('deleting only one of two copies does not free a slot', async () => {
  seed('userDeck', 20); seed('cloudDeck', 1);
  await run('decks/delete', { deckName: 'Deck 1' });
  assert.equal((await run('decks/save', payload('Replacement'))).statusCode, 409);
  await run('clouddecks/delete', { deckName: 'Deck 1' });
  assert.equal((await run('decks/save', payload('Replacement'))).statusCode, 200);
});

test('renames via id or old name cannot add a unique name while an old public copy remains', async () => {
  seed('userDeck', 20); seed('cloudDeck', 1);
  for (const extra of [{ deckId: 'userDeck_1' }, { oldDeckName: 'Deck 1' }]) {
    assert.equal((await run('decks/save', payload('Renamed', extra))).statusCode, 409);
  }
  assert.equal((await run('decks/save', payload('Renamed', { oldDeckName: 'Deck 2' }))).statusCode, 200);
  assert.equal((await quota()).count, 20);
  assert.equal((await run('decks/save', payload('Missing', { deckId: 'not-owned' }))).statusCode, 404);
});

test('simultaneous private/public saves for last slot are serialized and cannot both succeed', async () => {
  seed('userDeck', 19);
  const results = await Promise.all([
    run('decks/save', payload('Last private')),
    run('clouddecks/save', payload('Last public')),
  ]);
  assert.deepEqual(results.map((res) => res.statusCode).sort(), [200, 409]);
  assert.equal((await quota()).count, 20);
  assert.ok(attempts >= 4, 'conflicting write is retried before quota rejection');
});

test('public rename needs a slot if a private copy retains the original name', async () => {
  seed('cloudDeck', 20); seed('userDeck', 1);
  assert.equal((await run('clouddecks/save', payload('Renamed', { oldDeckName: 'Deck 1' }))).statusCode, 409);
  assert.equal((await run('clouddecks/save', payload('Renamed', { oldDeckName: 'Deck 2' }))).statusCode, 200);
  assert.equal((await quota()).count, 20);
});

test('serialization conflicts retry without additional HTTP calls, failures are bounded', async () => {
  forcedConflicts = 2;
  assert.equal((await run('decks/save', payload('New'))).statusCode, 200);
  assert.equal(attempts, 3);
  forcedConflicts = 5;
  const { serializable } = require('../lib/transaction');
  await assert.rejects(serializable(async () => null), (error) => error.code === 'P2034');
  assert.equal(attempts, 7);
});

test('migration exceeding joint quota rolls back every change and preserves source data', async () => {
  seed('userDeck', 19); seed('cloudDeck', 1, 'account', 19);
  seed('userDeck', 1, 'device', 30);
  state.userCollection.set('source', { id: 'source', userKey: 'device', cards: ['Sol Ring'] });
  const res = await run('auth-sync/migrate-user-data', { deviceToken });
  assert.equal(res.statusCode, 409);
  assert.equal((await quota()).count, 20);
  assert.ok([...state.userDeck.values()].some((deck) => deck.userKey === 'device'));
  assert.equal(state.userCollection.get('source').userKey, 'device');
});

test('migration uses transferred entitlement and duplicate names count once', async () => {
  seed('userDeck', 20); seed('cloudDeck', 1, 'account', 20);
  seed('userDeck', 20, 'device', 20);
  entitlement('device', { subActive: true, subExpiry: new Date(Date.now() + 86400000) });
  const res = await run('auth-sync/migrate-user-data', { deviceToken });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.migrated.decks, 20);
  assert.equal(res.body.migrated.entitlement, 1);
  assert.equal((await quota()).limit, 50);
  assert.equal((await quota()).count, 40);
});
