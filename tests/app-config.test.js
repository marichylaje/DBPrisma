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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {},
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
