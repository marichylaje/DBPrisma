const { google } = require('googleapis');

let _cached = null;

function getAndroidPublisherService() {
  if (_cached) return _cached;

  const packageName = process.env.GOOGLE_PACKAGE_NAME;
  const credsB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!packageName || !credsB64) {
    throw new Error('google_play_config_missing: GOOGLE_PACKAGE_NAME o GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 no configurados');
  }

  let creds;
  try {
    creds = JSON.parse(Buffer.from(credsB64, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('google_play_config_invalid: GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 no es un JSON base64 valido');
  }

  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  _cached = { svc: google.androidpublisher({ version: 'v3', auth }), packageName };
  return _cached;
}

// Estados de subscriptionsv2 en los que el usuario conserva acceso premium.
// IN_GRACE_PERIOD se incluye porque Google mantiene el acceso mientras reintenta el cobro.
const ACTIVE_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);

const GOOGLE_STATE_TO_SUB_STATUS = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period',
  SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
  SUBSCRIPTION_STATE_CANCELED: 'canceled',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
};

/**
 * Traduce el subscriptionState crudo de Google a nuestro vocabulario interno de subStatus.
 * Centralizado aquí para que api/iap/google-webhook.js y api/admin/reconcile-subscriptions.js
 * no dupliquen el mismo mapa (y para poder testearlo de forma aislada).
 */
function mapGoogleStateToStatus(state) {
  return GOOGLE_STATE_TO_SUB_STATUS[state] || 'unknown';
}

function maxExpiryFromLineItems(lineItems) {
  let max = 0;
  for (const item of lineItems || []) {
    const t = item.expiryTime ? Date.parse(item.expiryTime) : 0;
    if (t > max) max = t;
  }
  return max;
}

/**
 * Consulta el estado autoritativo de una suscripción a partir del purchaseToken usando
 * purchases.subscriptionsv2.get (la API vigente; purchases.subscriptions.get quedó deprecada
 * por Google en favor de esta). No requiere conocer el productId de antemano, por lo que
 * también sirve para procesar Real-time Developer Notifications (RTDN), que solo entregan el token.
 */
async function getSubscriptionStateByToken(purchaseToken) {
  if (!purchaseToken) {
    throw new Error('android_verify_bad_input: purchaseToken es requerido');
  }
  const { svc, packageName } = getAndroidPublisherService();
  const resp = await svc.purchases.subscriptionsv2.get({ packageName, token: purchaseToken });
  const state = resp.data.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED';
  const expiryMs = maxExpiryFromLineItems(resp.data.lineItems) || null;
  const active = ACTIVE_STATES.has(state) && !!expiryMs && expiryMs > Date.now();
  const productId = (resp.data.lineItems && resp.data.lineItems[0] && resp.data.lineItems[0].productId) || null;
  return { active, expiryMs, state, productId };
}

/**
 * Mantiene compatibilidad con el flujo existente de verificación en compra (api/iap/verify.js).
 * El productId ya no es necesario para consultar el estado (subscriptionsv2 solo usa el token),
 * pero se conserva en la firma para no romper llamadas existentes.
 */
async function verifyAndroidSub(_productId, purchaseToken) {
  const r = await getSubscriptionStateByToken(purchaseToken);
  return { active: r.active, expiryMs: r.expiryMs, productId: r.productId || _productId };
}

module.exports = { verifyAndroidSub, getSubscriptionStateByToken, mapGoogleStateToStatus };
