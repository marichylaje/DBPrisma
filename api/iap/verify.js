const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { verifyAppleReceipt } = require('../../lib/iap-apple');
const { verifyAndroidSub } = require('../../lib/iap-google');
const { checkSecret } = require('../../lib/auth');
const { logIapEvent } = require('../../lib/iapLogger');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  if (!checkSecret(req, res)) return;
  const userKey = String(req.query.userKey || '');
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  try {
    const body = req.body || {};
    if (body.platform === 'ios') {
      const r = await verifyAppleReceipt(body.receipt);

      // Anti-replay: un mismo original_transaction_id no puede quedar vinculado a dos cuentas.
      if (r.originalTransactionId) {
        const existing = await prisma.userEntitlement.findUnique({ where: { appleOriginalTransactionId: r.originalTransactionId } });
        if (existing && existing.userKey !== userKey) {
          logIapEvent({ level: 'warn', source: 'apple', event: 'verify_conflict', userKey, otherUserKey: existing.userKey, originalTransactionId: r.originalTransactionId });
          return res.status(409).json({ error: 'receipt_already_linked_to_another_account' });
        }
      }

      await prisma.userEntitlement.upsert({
        where: { userKey },
        create: { userKey, subActive:r.active, subPlatform:'ios', subProductId:r.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, appleOriginalTransactionId: r.originalTransactionId || null },
        update: {           subActive:r.active, subPlatform:'ios', subProductId:r.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, appleOriginalTransactionId: r.originalTransactionId || null },
      });
      logIapEvent({ source: 'apple', event: 'verify_ok', userKey, active: r.active, productId: r.productId });
      return res.json({ active:r.active, expiryMs:r.expiryMs ?? null, pending:false });
    }

    if (body.platform === 'android') {
      const allowPending = process.env.ALLOW_PENDING_ANDROID_PREMIUM === 'true';
      const disableVerify = process.env.DISABLE_ANDROID_VERIFY === 'true';
      const pendingDays = Number(process.env.PENDING_DEFAULT_DAYS || 7);

      // Anti-replay: un mismo purchaseToken no puede quedar vinculado a dos cuentas.
      if (body.purchaseToken) {
        const existingToken = await prisma.userEntitlement.findUnique({ where: { androidPurchaseToken: body.purchaseToken } });
        if (existingToken && existingToken.userKey !== userKey) {
          logIapEvent({ level: 'warn', source: 'android', event: 'verify_conflict', userKey, otherUserKey: existingToken.userKey });
          return res.status(409).json({ error: 'purchase_token_already_linked_to_another_account' });
        }
      }

      if (disableVerify) {
        const expires = new Date(Date.now() + pendingDays * 24*60*60*1000);
        await prisma.userEntitlement.upsert({
          where: { userKey },
          create: { userKey, subActive:allowPending, subPlatform:'android', subProductId:body.productId, subExpiry: allowPending?expires:null, pendingAndroid:true, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
          update: {           subActive:allowPending, subPlatform:'android', subProductId:body.productId, subExpiry: allowPending?expires:null, pendingAndroid:true, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
        });
        return res.json({ active:allowPending, pending:true, expiryMs: allowPending? expires.getTime(): null, note:'Android pendiente hasta habilitar API' });
      }

      const r = await verifyAndroidSub(body.productId, body.purchaseToken);
      await prisma.userEntitlement.upsert({
        where: { userKey },
        create: { userKey, subActive:r.active, subPlatform:'android', subProductId:body.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, pendingAndroid:false, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
        update: {           subActive:r.active, subPlatform:'android', subProductId:body.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null, pendingAndroid:false, androidPurchaseToken: body.purchaseToken, lastVerifyAt:new Date(), verifyError:null },
      });
      logIapEvent({ source: 'android', event: 'verify_ok', userKey, active: r.active, productId: r.productId });
      return res.json({ active:r.active, expiryMs:r.expiryMs ?? null, pending:false });
    }

    return res.status(400).json({ error: 'invalid platform' });
  } catch (e) {
    const msg = String((e && e.message) || e);
    logIapEvent({ level: 'error', source: 'unknown', event: 'verify_error', userKey, error: msg });
    if (msg.includes('_config_missing') || msg.includes('_config_invalid')) {
      return res.status(503).json({ error: 'iap_config_error', details: msg });
    }
    return res.status(500).json({ error: 'verify failed' });
  }
};

