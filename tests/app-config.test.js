process.env.NODE_ENV = 'test';
process.env.MIN_REQUIRED_VERSION_IOS = '1.2.0';
process.env.MIN_REQUIRED_VERSION_ANDROID = '1.3.0';

const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/app-config');

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end() {
      return this;
    },
  };
}

test('app-config returns independent minimum versions and preserves legacy fields', async () => {
  const res = mockRes();

  await handler({ method: 'GET', headers: {}, query: { currentVersion: '1.0.0' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.minRequiredVersionIos, '1.2.0');
  assert.equal(res.body.minRequiredVersionAndroid, '1.3.0');
  assert.equal(res.body.minRequiredVersion, res.body.latestVersion);
  assert.equal(res.body.isUpdateRequired, true);
});

test('legacy Android okhttp clients use the Android minimum, not the unified version', async () => {
  const res = mockRes();
  await handler({
    method: 'GET',
    headers: { 'user-agent': 'okhttp/4.12.0', 'x-app-version': '1.1.07' },
    query: {},
  }, res);
  assert.equal(res.body.latestVersion, '1.3.0');
  assert.equal(res.body.minRequiredVersion, '1.3.0');
  assert.equal(res.body.isUpdateRequired, true);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

for (const userAgent of ['Dalvik/2.1.0 (Linux; Android 15)', 'Mozilla/5.0 (Linux; Android 15)']) {
  test(`detects Android from ${userAgent}`, async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: { 'user-agent': userAgent }, query: { currentVersion: '1.2.0' } }, res);
    assert.equal(res.body.latestVersion, '1.3.0');
    assert.equal(res.body.isUpdateRequired, true);
  });
}

for (const userAgent of ['DeckBuilder/50 CFNetwork/1568 Darwin/24', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)']) {
  test(`keeps iOS policy independent for ${userAgent}`, async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: { 'user-agent': userAgent }, query: { currentVersion: '1.2.0' } }, res);
    assert.equal(res.body.latestVersion, '1.2.0');
    assert.equal(res.body.isUpdateRequired, false);
  });
}

for (const platform of ['android', 'ios']) {
  for (const source of ['query', 'x-app-platform', 'x-platform']) {
    test(`uses explicit ${platform} from ${source} ahead of user agent`, async () => {
      const res = mockRes();
      const headers = { 'user-agent': platform === 'ios' ? 'okhttp/4.12.0' : 'CFNetwork/1568' };
      const query = { currentVersion: '1.2.0' };
      if (source === 'query') query.platform = ` ${platform.toUpperCase()} `;
      else headers[source] = platform;
      await handler({ method: 'GET', headers, query }, res);
      assert.equal(res.body.latestVersion, platform === 'android' ? '1.3.0' : '1.2.0');
      assert.equal(res.body.isUpdateRequired, platform === 'android');
    });
  }
}

for (const currentVersion of ['1.3.0', '1.4.0', '', 'invalid']) {
  test(`does not block Android for current, newer, missing or invalid version: ${currentVersion}`, async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: { platform: 'android', currentVersion } }, res);
    assert.equal(res.body.isUpdateRequired, false);
  });
}

test('unknown platform retains unified policy instead of imposing Android minimum on iOS', async () => {
  const res = mockRes();
  await handler({
    method: 'GET',
    headers: { 'user-agent': 'unknown', 'x-app-platform': ['android'] },
    query: { platform: 'web', currentVersion: '1.1.07' },
  }, res);
  assert.equal(res.body.latestVersion, '1.1.03');
  assert.equal(res.body.isUpdateRequired, false);
});

test('preserves OPTIONS and unsupported method handling', async () => {
  for (const [method, statusCode] of [['OPTIONS', 204], ['POST', 405]]) {
    const res = mockRes();
    await handler({ method, headers: {}, query: {} }, res);
    assert.equal(res.statusCode, statusCode);
    assert.equal(res.body, undefined);
    for (const header of ['X-App-Version', 'X-App-Platform', 'X-Platform']) {
      assert.ok(res.headers['Access-Control-Allow-Headers'].split(', ').includes(header));
    }
  }
});
