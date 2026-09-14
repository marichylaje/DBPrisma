// test_iap_entitlement.js
//
// Pruebas de la lógica de IAP añadida en el Call 2 (mapeo de estados + anti-replay).
//
// IMPORTANTE: la parte de anti-replay (sección 2) requiere que la migración
// prisma/migrations/20260914120000_add_iap_webhook_support ya esté aplicada en la base de
// datos contra la que corras este script (añade las columnas únicas appleOriginalTransactionId
// y androidPurchaseToken, y la tabla ProcessedIapNotification). Si la corres antes de aplicar
// la migración, la sección 2 fallará con un error de columna/tabla inexistente - eso es esperado,
// no un bug del test.
//
// Uso: node test_iap_entitlement.js
require('dotenv').config();
const assert = require('assert');

const { mapGoogleStateToStatus } = require('./lib/iap-google');
const { mapAppleStatusToSubStatus } = require('./lib/iap-apple-server');
const { prisma } = require('./lib/prisma');

function testGoogleStateMapping() {
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_ACTIVE'), 'active');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), 'grace_period');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_ON_HOLD'), 'on_hold');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_CANCELED'), 'canceled');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_EXPIRED'), 'expired');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_PAUSED'), 'paused');
  assert.strictEqual(mapGoogleStateToStatus('SUBSCRIPTION_STATE_UNSPECIFIED'), 'unknown');
  assert.strictEqual(mapGoogleStateToStatus(undefined), 'unknown');
  console.log('✅ mapGoogleStateToStatus: OK');
}

function testAppleStatusMapping() {
  // Status: ACTIVE=1, EXPIRED=2, BILLING_RETRY=3, BILLING_GRACE_PERIOD=4, REVOKED=5
  assert.strictEqual(mapAppleStatusToSubStatus(1), 'active');
  assert.strictEqual(mapAppleStatusToSubStatus(2), 'expired');
  assert.strictEqual(mapAppleStatusToSubStatus(3), 'grace_period');
  assert.strictEqual(mapAppleStatusToSubStatus(4), 'grace_period');
  assert.strictEqual(mapAppleStatusToSubStatus(5), 'revoked');
  assert.strictEqual(mapAppleStatusToSubStatus(99), 'unknown');
  console.log('✅ mapAppleStatusToSubStatus: OK');
}

async function testAntiReplayConstraints() {
  const userA = 'dkb_test_iap_user_a';
  const userB = 'dkb_test_iap_user_b';
  const sharedToken = 'dkb_test_shared_purchase_token';
  const sharedOriginalTxId = 'dkb_test_shared_original_tx_id';

  // Limpieza previa por si quedó basura de una corrida anterior fallida.
  await prisma.userEntitlement.deleteMany({ where: { userKey: { in: [userA, userB] } } });

  await prisma.userEntitlement.create({
    data: { userKey: userA, subPlatform: 'android', androidPurchaseToken: sharedToken },
  });

  let rejected = false;
  try {
    await prisma.userEntitlement.create({
      data: { userKey: userB, subPlatform: 'android', androidPurchaseToken: sharedToken },
    });
  } catch (e) {
    rejected = String(e.code) === 'P2002'; // unique constraint violation
  }
  assert.strictEqual(rejected, true, 'la DB debería rechazar un androidPurchaseToken duplicado entre cuentas distintas');
  console.log('✅ constraint única androidPurchaseToken: OK');

  await prisma.userEntitlement.update({
    where: { userKey: userA },
    data: { appleOriginalTransactionId: sharedOriginalTxId },
  });

  rejected = false;
  try {
    await prisma.userEntitlement.create({
      data: { userKey: userB, subPlatform: 'ios', appleOriginalTransactionId: sharedOriginalTxId },
    });
  } catch (e) {
    rejected = String(e.code) === 'P2002';
  }
  assert.strictEqual(rejected, true, 'la DB debería rechazar un appleOriginalTransactionId duplicado entre cuentas distintas');
  console.log('✅ constraint única appleOriginalTransactionId: OK');

  await prisma.userEntitlement.deleteMany({ where: { userKey: { in: [userA, userB] } } });
}

async function main() {
  console.log('🔄 Iniciando pruebas de entitlement/IAP (Call 2)...');
  testGoogleStateMapping();
  testAppleStatusMapping();
  await testAntiReplayConstraints();
  console.log('🎉 Todas las pruebas de IAP pasaron.');
}

main()
  .catch((e) => {
    console.error('❌ Falló una prueba de IAP:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
