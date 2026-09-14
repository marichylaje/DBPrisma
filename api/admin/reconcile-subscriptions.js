// Reconciliación periódica de TODAS las suscripciones activas (iOS + Android), no solo las
// Android pendientes (eso ya lo cubre api/admin/reverify-pending.js). Complementa a los webhooks:
// los webhooks reaccionan a eventos en tiempo real, este job corrige cualquier evento perdido
// (entrega fallida, suscripción push mal configurada, etc.) revalidando contra la fuente de verdad.
//
// Pensado para invocarse por Vercel Cron (GET) o manualmente (POST). Vercel Cron no permite
// headers custom, así que además de x-app-secret se acepta `Authorization: Bearer <CRON_SECRET>`.
const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { getSubscriptionStateByToken, mapGoogleStateToStatus } = require('../../lib/iap-google');
const { getSubscriptionStatusByOriginalTransactionId } = require('../../lib/iap-apple-server');
const { checkSecret } = require('../../lib/auth');
const { logIapEvent } = require('../../lib/iapLogger');

function isAuthorized(req) {
  const expected = process.env.APP_BACKEND_SECRET;
  if (expected && req.headers['x-app-secret'] === expected) return true;

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  return false;
}

const APPLE_SERVER_API_CONFIGURED = !!(
  process.env.APPLE_ISSUER_ID &&
  process.env.APPLE_KEY_ID &&
  process.env.APPLE_BUNDLE_ID &&
  process.env.APPLE_IAP_PRIVATE_KEY_BASE64
);

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  if (!isAuthorized(req)) {
    // Reutiliza checkSecret para mantener el mensaje de error consistente con el resto de la API.
    if (!checkSecret(req, res)) return;
  }

  try {
    const activeSubs = await prisma.userEntitlement.findMany({
      where: { subActive: true },
    });

    const results = { android: [], ios: [], skippedIosNoServerApi: 0 };

    for (const ent of activeSubs) {
      if (ent.subPlatform === 'android' && ent.androidPurchaseToken) {
        try {
          const r = await getSubscriptionStateByToken(ent.androidPurchaseToken);
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: {
              subActive: r.active,
              subExpiry: r.expiryMs ? new Date(r.expiryMs) : null,
              subStatus: mapGoogleStateToStatus(r.state),
              lastVerifyAt: new Date(),
              verifyError: null,
            },
          });
          results.android.push({ userKey: ent.userKey, ok: true, active: r.active });
        } catch (e) {
          logIapEvent({ level: 'error', source: 'android', event: 'reconcile_row_failed', userKey: ent.userKey, error: String((e && e.message) || e) });
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: { lastVerifyAt: new Date(), verifyError: String((e && e.message) || e) },
          });
          results.android.push({ userKey: ent.userKey, ok: false, error: true });
        }
        continue;
      }

      if (ent.subPlatform === 'ios' && ent.appleOriginalTransactionId) {
        if (!APPLE_SERVER_API_CONFIGURED) {
          results.skippedIosNoServerApi++;
          continue;
        }
        try {
          const r = await getSubscriptionStatusByOriginalTransactionId(ent.appleOriginalTransactionId);
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: {
              subActive: r.active,
              subExpiry: r.expiryMs ? new Date(r.expiryMs) : null,
              subStatus: r.subStatus,
              lastVerifyAt: new Date(),
              verifyError: null,
            },
          });
          results.ios.push({ userKey: ent.userKey, ok: true, active: r.active });
        } catch (e) {
          logIapEvent({ level: 'error', source: 'apple', event: 'reconcile_row_failed', userKey: ent.userKey, error: String((e && e.message) || e) });
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: { lastVerifyAt: new Date(), verifyError: String((e && e.message) || e) },
          });
          results.ios.push({ userKey: ent.userKey, ok: false, error: true });
        }
      }
    }

    logIapEvent({
      source: 'reconcile',
      event: 'reconcile_summary',
      total: activeSubs.length,
      androidChecked: results.android.length,
      iosChecked: results.ios.length,
      skippedIosNoServerApi: results.skippedIosNoServerApi,
    });

    res.json({
      ok: true,
      total: activeSubs.length,
      androidChecked: results.android.length,
      iosChecked: results.ios.length,
      skippedIosNoServerApi: results.skippedIosNoServerApi,
      results,
    });
  } catch (e) {
    logIapEvent({ level: 'error', source: 'reconcile', event: 'reconcile_failed', error: String((e && e.message) || e) });
    res.status(500).json({ error: 'reconcile_failed' });
  }
};
