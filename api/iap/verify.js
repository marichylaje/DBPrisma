const { prisma } = require('../../lib/prisma');
const { verifyAppleReceipt } = require('../../lib/iap-apple');
const { verifyAndroidSub } = require('../../lib/iap-google');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.APP_BACKEND_SECRET && req.headers['x-app-secret'] !== process.env.APP_BACKEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const userKey = String(req.query.userKey || '');
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  try {
    const body = req.body || {};
    if (body.platform === 'ios') {
      const r = await verifyAppleReceipt(body.receipt);
      await prisma.userEntitlement.upsert({
        where: { userKey },
        create: { userKey, subActive:r.active, subPlatform:'ios', subProductId:r.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null },
        update: {           subActive:r.active, subPlatform:'ios', subProductId:r.productId, subExpiry: r.expiryMs? new Date(r.expiryMs): null },
      });
      return res.json({ active:r.active, expiryMs:r.expiryMs ?? null, pending:false });
    }

    if (body.platform === 'android') {
      const allowPending = process.env.ALLOW_PENDING_ANDROID_PREMIUM === 'true';
      const disableVerify = process.env.DISABLE_ANDROID_VERIFY === 'true';
      const pendingDays = Number(process.env.PENDING_DEFAULT_DAYS || 7);

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
      return res.json({ active:r.active, expiryMs:r.expiryMs ?? null, pending:false });
    }

    return res.status(400).json({ error: 'invalid platform' });
  } catch (e) {
    console.error('verify error', e);
    return res.status(500).json({ error: 'verify failed' });
  }
};
