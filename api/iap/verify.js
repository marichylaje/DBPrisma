const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { verifyAppleReceipt } = require('../../lib/iap-apple');
const { verifyAndroidSub } = require('../../lib/iap-google');
const { requireOwner } = require('../../lib/auth');
const { logIapEvent } = require('../../lib/iapLogger');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { resolveOwnerRecord } = require('../../lib/userLookup');

const MAX_FIELD_LENGTH = 20000;
const IOS_ALLOWED_PRODUCT_IDS = new Set([
  'premium.support.5',
  'premium.support.8',
  'premium.support.12',
  'premium.support.15',
  'premium.support.20',
]);
const ANDROID_ALLOWED_PRODUCT_IDS = new Set([
  'premium_support_5',
  'premium_support_8',
  'premium_support_12',
  'premium_support_15',
  'premium_support_20',
]);

function isBoundedString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

function isAllowedProductId(platform, productId) {
  if (platform === 'ios') return IOS_ALLOWED_PRODUCT_IDS.has(productId);
  if (platform === 'android') return ANDROID_ALLOWED_PRODUCT_IDS.has(productId);
  return false;
}

function normalizeIosVerificationResult(verificationResult) {
  const hasInvalidProduct = isBoundedString(verificationResult.productId)
    && !isAllowedProductId('ios', verificationResult.productId);

  if (!hasInvalidProduct) {
    return { result: verificationResult, hasInvalidProduct: false };
  }

  return {
    result: { ...verificationResult, active: false, expiryMs: null },
    hasInvalidProduct: true,
  };
}

const handler = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  const auth = requireOwner(req, res);
  if (!auth) return;
  // Evita fuzzing/spam de recibos de compra contra Apple/Google desde una misma IP.
  const tiersOk = await checkRateLimitTiers(req, res, 'iap-verify', [
    { id: 'burst', limit: 8, windowSeconds: 10 },
    { id: 'sustained', limit: 20, windowSeconds: 600 },
  ]);
  if (!tiersOk) return;

  // El entitlement se asocia SOLO al dueño del token (el cliente no elige el userKey).
  let userKey;
  let nickname;
  try {
    ({ userKey, nickname } = await resolveOwnerRecord(auth));
  } catch (e) {
    return res.status(500).json({ error: 'verify failed' });
  }

  try {
    const body = req.body || {};
    if (body.platform === 'ios' && !isBoundedString(body.receipt)) {
      return res.status(400).json({ error: 'receipt required' });
    }
    if (body.platform === 'android' && (!isBoundedString(body.purchaseToken) || !isBoundedString(body.productId))) {
      return res.status(400).json({ error: 'productId and purchaseToken required' });
    }
    if (body.platform === 'ios') {
      const r = await verifyAppleReceipt(body.receipt);
      const { result: verifiedResult, hasInvalidProduct } = normalizeIosVerificationResult(r);

      if (hasInvalidProduct) {
        logIapEvent({ level: 'warn', source: 'apple', event: 'verify_invalid_product_id', userKey, productId: r.productId });
      }

      // Anti-replay: un mismo original_transaction_id no puede quedar vinculado a dos cuentas.
      if (verifiedResult.originalTransactionId) {
        const existing = await prisma.userEntitlement.findUnique({ where: { appleOriginalTransactionId: verifiedResult.originalTransactionId } });
        if (existing && existing.userKey !== userKey) {
          logIapEvent({ level: 'warn', source: 'apple', event: 'verify_conflict', userKey, otherUserKey: existing.userKey, originalTransactionId: verifiedResult.originalTransactionId });
          return res.status(409).json({ error: 'receipt_already_linked_to_another_account' });
        }
      }

      await prisma.userEntitlement.upsert({
        where: { userKey },
        create: { userKey, nickname, subActive:verifiedResult.active, subPlatform:'ios', subProductId:verifiedResult.productId, subExpiry: verifiedResult.expiryMs? new Date(verifiedResult.expiryMs): null, appleOriginalTransactionId: verifiedResult.originalTransactionId || null },
        update: {           nickname, subActive:verifiedResult.active, subPlatform:'ios', subProductId:verifiedResult.productId, subExpiry: verifiedResult.expiryMs? new Date(verifiedResult.expiryMs): null, appleOriginalTransactionId: verifiedResult.originalTransactionId || null },
      });
      logIapEvent({ source: 'apple', event: 'verify_ok', userKey, active: verifiedResult.active, productId: verifiedResult.productId });
      return res.json({ active:verifiedResult.active, expiryMs:verifiedResult.expiryMs ?? null, pending:false });
    }

    if (body.platform === 'android') {
      if (!isAllowedProductId('android', body.productId)) {
        return res.status(400).json({ error: 'invalid_product_id' });
      }

      const allowPending = process.env.ALLOW_PENDING_ANDROID_PREMIUM === 'true';
      // Tope de seguridad: aunque PENDING_DEFAULT_DAYS esté mal configurado (o sea muy alto),
      // nunca se concede más de MAX_PENDING_DAYS de acceso premium sin verificación real.
      const MAX_PENDING_DAYS = 30;
      const pendingDays = Math.min(Math.max(Number(process.env.PENDING_DEFAULT_DAYS) || 7, 1), MAX_PENDING_DAYS);
      const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
      // El bypass de verificación está BLOQUEADO en producción aunque la variable quede encendida.
      const disableVerify = !isProduction && process.env.DISABLE_ANDROID_VERIFY === 'true';

      // Anti-replay: un mismo purchaseToken no puede quedar vinculado a dos cuentas.
      if (body.purchaseToken) {
        const existingToken = await prisma.userEntitlement.findUnique({ where: { androidPurchaseToken: body.purchaseToken } });
        if (existingToken && existingToken.userKey !== userKey) {
          logIapEvent({ level: 'warn', source: 'android', event: 'verify_conflict', userKey, otherUserKey: existingToken.userKey });
          return res.status(409).json({ error: 'purchase_token_already_linked_to_another_account' });
        }
      }

      if (disableVerify) {
        // ⚠️ Bypass temporal mientras no haya acceso a la API de verificación de Google Play:
        // esta rama NO valida la compra real contra Google, confía en lo que envía el cliente.
        // Queda auditado en cada llamada (incluida la bandera `isProduction`) para poder
        // detectar si esta flag peligrosa quedó encendida por error en producción.
        logIapEvent({
          level: 'warn',
          source: 'android',
          event: 'verify_bypassed_unverified_grant',
          userKey,
          productId: body.productId,
          pendingDays,
          allowPending,
          isProduction,
        });

        const expires = new Date(Date.now() + pendingDays * 24*60*60*1000);
        await prisma.userEntitlement.upsert({
          where: { userKey },
          create: { userKey, nickname, subActive:allowPending, subPlatform:'android', subProductId:body.productId, subExpiry: allowPending?expires:null, pendingAndroid:true, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
          update: {           nickname, subActive:allowPending, subPlatform:'android', subProductId:body.productId, subExpiry: allowPending?expires:null, pendingAndroid:true, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
        });
        return res.json({ active:allowPending, pending:true, expiryMs: allowPending? expires.getTime(): null, note:'Android pendiente hasta habilitar API' });
      }

      const r = await verifyAndroidSub(body.productId, body.purchaseToken);
      await prisma.userEntitlement.upsert({
        where: { userKey },
        create: { userKey, nickname, subActive:r.active, subPlatform:'android', subProductId:r.productId || body.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, pendingAndroid:false, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
        update: {           nickname, subActive:r.active, subPlatform:'android', subProductId:r.productId || body.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, pendingAndroid:false, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
      });
      logIapEvent({ source: 'android', event: 'verify_ok', userKey, active: r.active, productId: r.productId });
      return res.json({ active:r.active, expiryMs:r.expiryMs ?? null, pending:false });
    }

    return res.status(400).json({ error: 'invalid platform' });
  } catch (e) {
    const msg = String((e && e.message) || e);
    logIapEvent({ level: 'error', source: 'unknown', event: 'verify_error', userKey, error: msg });
    if (msg.includes('_config_missing') || msg.includes('_config_invalid')) {
      return res.status(503).json({ error: 'iap_config_error' });
    }
    return res.status(500).json({ error: 'verify failed' });
  }
};

module.exports = handler;
module.exports._internals = {
  IOS_ALLOWED_PRODUCT_IDS,
  ANDROID_ALLOWED_PRODUCT_IDS,
  isAllowedProductId,
  normalizeIosVerificationResult,
};
