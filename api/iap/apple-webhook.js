// Webhook de App Store Server Notifications V2.
// Configúralo en App Store Connect > Users and Access > Integrations > App Store Server Notifications.
//
// IMPORTANTE: Apple no puede enviar nuestro header x-app-secret, así que este endpoint NO usa
// checkSecret(). Su autenticación es criptográfica: SignedDataVerifier valida que el payload
// viene firmado por Apple (cadena de certificados hasta un Apple Root CA) y que el bundleId /
// entorno coinciden con los configurados. Cualquier payload que falle esa verificación se rechaza.
const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { verifyAndDecodeNotification } = require('../../lib/iap-apple-server');
const { logIapEvent } = require('../../lib/iapLogger');

function mapToEntitlementUpdate(notificationType, subtype, transaction) {
  const expiresDate = transaction?.expiresDate || null;
  const revoked = notificationType === 'REVOKE';
  const refunded = notificationType === 'REFUND';
  const expired = notificationType === 'EXPIRED';
  const failedGrace = notificationType === 'DID_FAIL_TO_RENEW' && subtype === 'GRACE_PERIOD';
  const graceExpired = notificationType === 'GRACE_PERIOD_EXPIRED';

  let subActive;
  let subStatus;

  if (revoked || refunded) {
    subActive = false;
    subStatus = revoked ? 'revoked' : 'refunded';
  } else if (expired || graceExpired) {
    subActive = false;
    subStatus = 'expired';
  } else if (failedGrace) {
    subStatus = 'grace_period';
    subActive = !!expiresDate && expiresDate > Date.now();
  } else {
    subActive = !!expiresDate && expiresDate > Date.now();
    subStatus = subtype === 'AUTO_RENEW_DISABLED' ? 'canceled' : 'active';
  }

  return {
    subActive,
    subStatus,
    subExpiry: expiresDate ? new Date(expiresDate) : undefined,
    subProductId: transaction?.productId || undefined,
  };
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  const signedPayload = (req.body && req.body.signedPayload) || null;
  if (!signedPayload) return res.status(400).json({ error: 'signedPayload required' });

  let decoded;
  try {
    decoded = await verifyAndDecodeNotification(signedPayload);
  } catch (e) {
    logIapEvent({ level: 'error', source: 'apple', event: 'webhook_invalid_signature', error: String((e && e.message) || e) });
    return res.status(400).json({ error: 'invalid_signature' });
  }

  const { notification, transaction } = decoded;
  const notificationId = notification.notificationUUID;
  const notificationType = notification.notificationType;
  const subtype = notification.subtype;

  try {
    if (notificationId) {
      const already = await prisma.processedIapNotification.findUnique({ where: { notificationId } });
      if (already) {
        return res.json({ ok: true, duplicate: true });
      }
    }

    if (notificationType === 'TEST') {
      if (notificationId) {
        await prisma.processedIapNotification.create({
          data: { source: 'apple', notificationId, notificationType },
        });
      }
      return res.json({ ok: true, test: true });
    }

    const originalTransactionId = transaction?.originalTransactionId;
    let userKey = null;

    if (originalTransactionId) {
      const ent = await prisma.userEntitlement.findUnique({ where: { appleOriginalTransactionId: originalTransactionId } });
      if (ent) {
        userKey = ent.userKey;
        const update = mapToEntitlementUpdate(notificationType, subtype, transaction);
        await prisma.userEntitlement.update({
          where: { userKey: ent.userKey },
          data: { ...update, lastVerifyAt: new Date(), verifyError: null },
        });
      } else {
        logIapEvent({ level: 'warn', source: 'apple', event: 'webhook_unlinked_transaction', originalTransactionId, notificationType });
      }
    }

    if (notificationId) {
      await prisma.processedIapNotification.create({
        data: { source: 'apple', notificationId, notificationType, userKey },
      });
    }

    logIapEvent({ source: 'apple', event: 'webhook_processed', notificationType, subtype, userKey, notificationId });
    return res.json({ ok: true });
  } catch (e) {
    logIapEvent({ level: 'error', source: 'apple', event: 'webhook_processing_error', error: String((e && e.message) || e) });
    return res.status(500).json({ error: 'processing_failed' });
  }
};
