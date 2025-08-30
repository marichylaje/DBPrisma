const { prisma } = require('../../lib/prisma');
const { verifyAndroidSub } = require('../../lib/iap-google');

module.exports = async (req, res) => {
  // Protegido por el mismo secret de app
  if (process.env.APP_BACKEND_SECRET && req.headers['x-app-secret'] !== process.env.APP_BACKEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  try {
    const pend = await prisma.userEntitlement.findMany({
      where: { pendingAndroid: true, androidPurchaseToken: { not: null } },
    });

    const results = [];
    for (const ent of pend) {
      try {
        const r = await verifyAndroidSub(ent.subProductId, ent.androidPurchaseToken);
        await prisma.userEntitlement.update({
          where: { userKey: ent.userKey },
          data: {
            subActive: r.active,
            subExpiry: r.expiryMs ? new Date(r.expiryMs) : null,
            pendingAndroid: false,
            lastVerifyAt: new Date(),
            verifyError: null,
          },
        });
        results.push({ userKey: ent.userKey, active: r.active, ok: true });
      } catch (e) {
        await prisma.userEntitlement.update({
          where: { userKey: ent.userKey },
          data: { lastVerifyAt: new Date(), verifyError: String(e) },
        });
        results.push({ userKey: ent.userKey, ok: false, error: true });
      }
    }

    res.json({ updated: results.length, results });
  } catch (e) {
    console.error('reverify-pending error', e);
    res.status(500).json({ error: 'reverify failed' });
  }
};
 