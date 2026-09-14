// Envoltorio sobre el SDK oficial de Apple (@apple/app-store-server-library) para:
//  1) Verificar y decodificar App Store Server Notifications V2 (webhook).
//  2) Consultar el estado autoritativo de una suscripción vía App Store Server API
//     (usado por la reconciliación periódica).
//
// Nunca se implementa verificación de firma/cadena de certificados a mano: se usa
// SignedDataVerifier del SDK oficial, que valida la cadena x5c contra los Apple Root CA
// que tú mismo debes descargar desde https://www.apple.com/certificateauthority/ y
// configurar en APPLE_ROOT_CA_BASE64 (uno o más certificados DER en base64, separados por coma).

const {
  SignedDataVerifier,
  AppStoreServerAPIClient,
  Environment,
  Status,
} = require('@apple/app-store-server-library');

function getEnvironment() {
  return process.env.APPLE_ENVIRONMENT === 'SANDBOX' ? Environment.SANDBOX : Environment.PRODUCTION;
}

function loadRootCertificates() {
  const raw = process.env.APPLE_ROOT_CA_BASE64;
  if (!raw) {
    throw new Error('apple_config_missing: APPLE_ROOT_CA_BASE64 no configurado (descarga los certificados en https://www.apple.com/certificateauthority/)');
  }
  return raw.split(',').map((b64) => Buffer.from(b64.trim(), 'base64'));
}

let _verifier = null;
function getVerifier() {
  if (_verifier) return _verifier;

  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    throw new Error('apple_config_missing: APPLE_BUNDLE_ID no configurado');
  }
  const environment = getEnvironment();
  const appAppleId = environment === Environment.PRODUCTION ? Number(process.env.APPLE_APP_APPLE_ID || 0) || undefined : undefined;
  if (environment === Environment.PRODUCTION && !appAppleId) {
    throw new Error('apple_config_missing: APPLE_APP_APPLE_ID es requerido en entorno PRODUCTION');
  }

  const rootCAs = loadRootCertificates();
  _verifier = new SignedDataVerifier(rootCAs, true, environment, bundleId, appAppleId);
  return _verifier;
}

/**
 * Verifica (firma + cadena de certificados + bundleId + entorno) y decodifica un notificationPayload
 * de App Store Server Notifications V2. Lanza si la verificación falla (payload no confiable).
 */
async function verifyAndDecodeNotification(signedPayload) {
  const verifier = getVerifier();
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);

  let transaction = null;
  let renewalInfo = null;
  if (notification.data?.signedTransactionInfo) {
    transaction = await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo);
  }
  if (notification.data?.signedRenewalInfo) {
    renewalInfo = await verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo);
  }

  return { notification, transaction, renewalInfo };
}

let _apiClient = null;
function getApiClient() {
  if (_apiClient) return _apiClient;

  const issuerId = process.env.APPLE_ISSUER_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const privateKeyB64 = process.env.APPLE_IAP_PRIVATE_KEY_BASE64;
  if (!issuerId || !keyId || !bundleId || !privateKeyB64) {
    throw new Error('apple_server_api_config_missing: APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_BUNDLE_ID o APPLE_IAP_PRIVATE_KEY_BASE64 no configurados. Genera la clave en App Store Connect > Users and Access > Integrations > In-App Purchase.');
  }

  const signingKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');
  _apiClient = new AppStoreServerAPIClient(signingKey, keyId, issuerId, bundleId, getEnvironment());
  return _apiClient;
}

// Status: ACTIVE=1, EXPIRED=2, BILLING_RETRY=3, BILLING_GRACE_PERIOD=4, REVOKED=5
const ACTIVE_STATUSES = new Set([Status.ACTIVE, Status.BILLING_GRACE_PERIOD]);

function mapAppleStatusToSubStatus(statusCode) {
  switch (statusCode) {
    case Status.ACTIVE: return 'active';
    case Status.EXPIRED: return 'expired';
    case Status.BILLING_RETRY: return 'grace_period';
    case Status.BILLING_GRACE_PERIOD: return 'grace_period';
    case Status.REVOKED: return 'revoked';
    default: return 'unknown';
  }
}

/**
 * Reconciliación pull: consulta el estado autoritativo de todas las suscripciones asociadas
 * a un originalTransactionId. Requiere haber configurado la App Store Server API (clave .p8).
 */
async function getSubscriptionStatusByOriginalTransactionId(originalTransactionId) {
  const client = getApiClient();
  const verifier = getVerifier();

  const statusResponse = await client.getAllSubscriptionStatuses(originalTransactionId);
  let best = null;

  for (const group of statusResponse.data || []) {
    for (const item of group.lastTransactions || []) {
      if (!item.signedTransactionInfo) continue;
      const decoded = await verifier.verifyAndDecodeTransaction(item.signedTransactionInfo);
      const expiresDate = decoded.expiresDate || 0;
      if (!best || expiresDate > best.expiresDate) {
        best = { status: item.status, expiresDate, decoded };
      }
    }
  }

  if (!best) {
    return { active: false, expiryMs: null, status: null, productId: null };
  }

  return {
    active: ACTIVE_STATUSES.has(best.status) && best.expiresDate > Date.now(),
    expiryMs: best.expiresDate || null,
    status: best.status,
    subStatus: mapAppleStatusToSubStatus(best.status),
    productId: best.decoded.productId || null,
    revoked: best.status === Status.REVOKED,
  };
}

module.exports = {
  Environment,
  verifyAndDecodeNotification,
  getSubscriptionStatusByOriginalTransactionId,
  mapAppleStatusToSubStatus,
};
