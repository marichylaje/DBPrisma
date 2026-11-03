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
  VerificationException,
  VerificationStatus,
} = require('@apple/app-store-server-library');
const { logIapEvent } = require('./iapLogger');

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

const _verifiers = new Map();
function getVerifierForEnvironment(environment) {
  if (_verifiers.has(environment)) return _verifiers.get(environment);

  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    throw new Error('apple_config_missing: APPLE_BUNDLE_ID no configurado');
  }
  const appAppleId = environment === Environment.PRODUCTION ? Number(process.env.APPLE_APP_APPLE_ID || 0) || undefined : undefined;
  if (environment === Environment.PRODUCTION && !appAppleId) {
    throw new Error('apple_config_missing: APPLE_APP_APPLE_ID es requerido en entorno PRODUCTION');
  }

  let verifier;
  try {
    verifier = new SignedDataVerifier(loadRootCertificates(), true, environment, bundleId, appAppleId);
  } catch (e) {
    if (String((e && e.message) || e).includes('_config_missing')) throw e;
    throw new Error(`apple_config_invalid: APPLE_ROOT_CA_BASE64 no es válido (${(e && e.message) || e})`);
  }
  _verifiers.set(environment, verifier);
  return verifier;
}

function getVerifier() {
  return getVerifierForEnvironment(getEnvironment());
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

const _apiClients = new Map();
function isApiClientConfigured() {
  return Boolean(
    process.env.APPLE_ISSUER_ID
    && process.env.APPLE_KEY_ID
    && process.env.APPLE_BUNDLE_ID
    && process.env.APPLE_IAP_PRIVATE_KEY_BASE64,
  );
}

function getApiClient(environment = getEnvironment()) {
  if (_apiClients.has(environment)) return _apiClients.get(environment);

  const issuerId = process.env.APPLE_ISSUER_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  const privateKeyB64 = process.env.APPLE_IAP_PRIVATE_KEY_BASE64;
  if (!issuerId || !keyId || !bundleId || !privateKeyB64) {
    throw new Error('apple_server_api_config_missing: APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_BUNDLE_ID o APPLE_IAP_PRIVATE_KEY_BASE64 no configurados. Genera la clave en App Store Connect > Users and Access > Integrations > In-App Purchase.');
  }

  const signingKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');
  const client = new AppStoreServerAPIClient(signingKey, keyId, issuerId, bundleId, environment);
  _apiClients.set(environment, client);
  return client;
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
async function getSubscriptionStatusByOriginalTransactionId(originalTransactionId, environment = getEnvironment()) {
  const client = getApiClient(environment);
  const verifier = getVerifierForEnvironment(environment);

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

const APPLE_JWS_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** True si el valor parece un JWS compacto (transacción firmada de StoreKit 2) y no un recibo base64 legacy. */
function isSignedTransaction(value) {
  return typeof value === 'string' && APPLE_JWS_REGEX.test(value);
}

function tagError(code, cause) {
  const err = new Error(`apple_${code}${cause ? `: ${cause.message || cause}` : ''}`);
  err.appleCode = code;
  return err;
}

/**
 * Verifica una transacción firmada de StoreKit 2 (JWS que envía el cliente en `purchaseToken`):
 * firma + cadena de certificados + bundleId + entorno, con el SDK oficial.
 *
 * - En producción también acepta transacciones Sandbox (App Review y TestFlight prueban contra Sandbox
 *   con el binario de producción), igual que hacía el flujo legacy con el código 21007.
 * - Si la App Store Server API está configurada, el estado final (renovación, gracia, reembolso) se toma
 *   de Apple; si no, se usa la propia transacción verificada (los webhooks V2 la mantienen al día).
 *
 * Lanza un error con `appleCode`: 'invalid_transaction' (no confiable) o 'verification_unavailable' (reintentable).
 * Los errores de configuración (`apple_config_missing`) se propagan tal cual.
 */
async function verifyAppleTransaction(signedTransactionInfo) {
  const configured = getEnvironment();
  const candidates = configured === Environment.PRODUCTION
    ? [Environment.PRODUCTION, Environment.SANDBOX]
    : [configured];

  let decoded = null;
  let environment = null;
  for (const candidate of candidates) {
    const verifier = getVerifierForEnvironment(candidate);
    try {
      decoded = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      environment = candidate;
      break;
    } catch (e) {
      if (!(e instanceof VerificationException)) throw e;
      if (e.status === VerificationStatus.INVALID_ENVIRONMENT) continue;
      if (e.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
        throw tagError('verification_unavailable', e);
      }
      throw tagError('invalid_transaction', e);
    }
  }
  if (!decoded) throw tagError('invalid_transaction');

  const expiresDate = decoded.expiresDate || 0;
  const revoked = Boolean(decoded.revocationDate);
  const isSubscription = !decoded.type || decoded.type === 'Auto-Renewable Subscription';
  let result = {
    active: isSubscription && !revoked && expiresDate > Date.now(),
    expiryMs: expiresDate || null,
    productId: decoded.productId,
    originalTransactionId: decoded.originalTransactionId,
    bundleId: decoded.bundleId,
    environment,
  };

  if (isSubscription && decoded.originalTransactionId && isApiClientConfigured()) {
    try {
      const status = await getSubscriptionStatusByOriginalTransactionId(decoded.originalTransactionId, environment);
      if (status && status.status !== null) {
        result = {
          ...result,
          active: Boolean(status.active) && !status.revoked,
          expiryMs: status.expiryMs || result.expiryMs,
          productId: status.productId || result.productId,
        };
      }
    } catch (e) {
      // La API de servidor es un refuerzo: si falla se conserva el resultado de la transacción firmada.
      logIapEvent({ level: 'warn', source: 'apple', event: 'verify_status_api_unavailable', originalTransactionId: decoded.originalTransactionId, error: String((e && e.message) || e) });
    }
  }

  return result;
}

module.exports = {
  Environment,
  verifyAndDecodeNotification,
  verifyAppleTransaction,
  isSignedTransaction,
  getSubscriptionStatusByOriginalTransactionId,
  mapAppleStatusToSubStatus,
};
