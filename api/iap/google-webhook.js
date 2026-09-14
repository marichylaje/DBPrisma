// Webhook de Google Play Real-time Developer Notifications (RTDN), entregado vía Cloud Pub/Sub push.
// Configura la suscripción push apuntando a esta URL y protégela con autenticación push
// (cuenta de servicio) para que Google adjunte un ID token verificable en Authorization.
//
// IMPORTANTE: este endpoint tampoco usa checkSecret(x-app-secret) porque Pub/Sub no puede
// enviar headers custom; la autenticación es el ID token OIDC firmado por Google (ver
// lib/google-pubsub-auth.js), verificado contra GOOGLE_PUBSUB_AUDIENCE.
const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { getSubscriptionStateByToken, mapGoogleStateToStatus } = require('../../lib/iap-google');
const { verifyPubSubPushToken } = require('../../lib/google-pubsub-auth');
const { logIapEvent } = require('../../lib/iapLogger');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await verifyPubSubPushToken(req.headers['authorization']);
  } catch (e) {
    logIapEvent({ level: 'error', source: 'google', event: 'webhook_invalid_token', error: String((e && e.message) || e) });
    return res.status(401).json({ error: 'unauthorized' });
  }

  const message = req.body && req.body.message;
  if (!message || !message.data) {
    return res.status(400).json({ error: 'invalid_pubsub_envelope' });
  }

  const messageId = message.messageId;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8'));
  } catch (e) {
    logIapEvent({ level: 'error', source: 'google', event: 'webhook_invalid_message_data', error: String((e && e.message) || e) });
    return res.status(400).json({ error: 'invalid_message_data' });
  }

  try {
    if (messageId) {
      const already = await prisma.processedIapNotification.findUnique({ where: { notificationId: messageId } });
      if (already) {
        return res.json({ ok: true, duplicate: true });
      }
    }

    let userKey = null;
    let notificationType = null;

    if (payload.testNotification) {
      notificationType = 'TEST';
    } else if (payload.subscriptionNotification) {
      const { purchaseToken, notificationType: nt } = payload.subscriptionNotification;
      notificationType = `SUBSCRIPTION_${nt}`;

      const ent = await prisma.userEntitlement.findUnique({ where: { androidPurchaseToken: purchaseToken } });
      if (ent) {
        userKey = ent.userKey;
        try {
          const r = await getSubscriptionStateByToken(purchaseToken);
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: {
              subActive: r.active,
              subExpiry: r.expiryMs ? new Date(r.expiryMs) : null,
              subStatus: mapGoogleStateToStatus(r.state),
              subProductId: r.productId || ent.subProductId,
              pendingAndroid: false,
              lastVerifyAt: new Date(),
              verifyError: null,
            },
          });
        } catch (verifyErr) {
          logIapEvent({ level: 'error', source: 'google', event: 'webhook_reverify_failed', userKey, error: String((verifyErr && verifyErr.message) || verifyErr) });
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: { lastVerifyAt: new Date(), verifyError: String(verifyErr && verifyErr.message || verifyErr) },
          });
        }
      } else {
        logIapEvent({ level: 'warn', source: 'google', event: 'webhook_unlinked_token', notificationType: nt });
      }
    } else if (payload.voidedPurchaseNotification) {
      const { purchaseToken, productType } = payload.voidedPurchaseNotification;
      notificationType = 'VOIDED_PURCHASE';
      if (productType === 1) {
        // 1 = PRODUCT_TYPE_SUBSCRIPTION
        const ent = await prisma.userEntitlement.findUnique({ where: { androidPurchaseToken: purchaseToken } });
        if (ent) {
          userKey = ent.userKey;
          await prisma.userEntitlement.update({
            where: { userKey: ent.userKey },
            data: { subActive: false, subStatus: 'revoked', lastVerifyAt: new Date(), verifyError: null },
          });
        } else {
          logIapEvent({ level: 'warn', source: 'google', event: 'webhook_voided_unlinked_token' });
        }
      }
    } else if (payload.pendingRefundReviewNotification) {
      notificationType = 'PENDING_REFUND_REVIEW';
      // Requiere revisión manual + llamada a la API ReviewRefund dentro de 24h. No se automatiza aquí.
      logIapEvent({ level: 'warn', source: 'google', event: 'webhook_pending_refund_review' });
    } else if (payload.oneTimeProductNotification) {
      notificationType = 'ONE_TIME_PRODUCT';
      // La app actual no vende productos de una sola compra; se ignora salvo registro para idempotencia.
    }

    if (messageId) {
      await prisma.processedIapNotification.create({
        data: { source: 'google', notificationId: messageId, notificationType, userKey },
      });
    }

    logIapEvent({ source: 'google', event: 'webhook_processed', notificationType, userKey, notificationId: messageId });
    return res.json({ ok: true });
  } catch (e) {
    logIapEvent({ level: 'error', source: 'google', event: 'webhook_processing_error', error: String((e && e.message) || e) });
    return res.status(500).json({ error: 'processing_failed' });
  }
};
