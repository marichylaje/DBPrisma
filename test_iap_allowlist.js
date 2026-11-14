require('dotenv').config();
const assert = require('assert');

const { _internals } = require('./api/iap/verify');

function testAndroidAllowlist() {
  for (const productId of [
    'premium_month',
    'supporter_8_month',
    'supporter_12_month',
    'supporter_15_month',
    'supporter_20_month',
    'premium_support_5',
    'premium_support_8',
    'premium_support_12',
    'premium_support_15',
    'premium_support_20',
  ]) {
    assert.strictEqual(_internals.isAllowedProductId('android', productId), true);
  }
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
