require('dotenv').config();
const assert = require('assert');

const { _internals } = require('./api/iap/verify');

function testAndroidAllowlist() {
  assert.strictEqual(_internals.isAllowedProductId('android', 'premium_support_5'), true);
  assert.strictEqual(_internals.isAllowedProductId('android', 'premium_support_20'), true);
  assert.strictEqual(_internals.isAllowedProductId('android', 'premium_support_invalid'), false);
  console.log('✅ allowlist Android: OK');
}

function testIosInvalidProductDoesNotGrantPremium() {
  const verificationResult = {
    active: true,
    expiryMs: Date.now() + 1000 * 60 * 60 * 24,
    productId: 'premium.support.invalid',
  };

  const normalized = _internals.normalizeIosVerificationResult(verificationResult);
  assert.strictEqual(normalized.hasInvalidProduct, true);
  assert.strictEqual(normalized.result.active, false);
  assert.strictEqual(normalized.result.expiryMs, null);
  console.log('✅ iOS productId fuera de allowlist no activa premium: OK');
}

function main() {
  console.log('🔄 Iniciando pruebas de allowlist IAP...');
  testAndroidAllowlist();
  testIosInvalidProductDoesNotGrantPremium();
  console.log('🎉 Todas las pruebas de allowlist IAP pasaron.');
}

main();
