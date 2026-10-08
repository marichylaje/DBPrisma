// CommonJS runtime version used by API handlers in production.

const UNKNOWN_PRODUCT_LABEL = 'desconocido';

const GOOGLE_EVENT_TYPE_BY_CODE = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
};

const GOOGLE_MESSAGE_BY_EVENT_TYPE = {
  SUBSCRIPTION_PURCHASED: (productId) => `Nueva suscripcion: plan ${productId}.`,
  SUBSCRIPTION_RENEWED: (productId) => `Renovacion exitosa para ${productId}.`,
  SUBSCRIPTION_RECOVERED: (productId) => `Pago recuperado para ${productId}.`,
  SUBSCRIPTION_CANCELED: (productId) => `Cancelacion programada para ${productId}.`,
  SUBSCRIPTION_IN_GRACE_PERIOD: (productId) => `Fallo de cobro: periodo de gracia en ${productId}.`,
  SUBSCRIPTION_ON_HOLD: (productId) => `Suscripcion en hold por falta de pago: ${productId}.`,
  SUBSCRIPTION_EXPIRED: (productId) => `Suscripcion expirada: ${productId}.`,
  SUBSCRIPTION_REVOKED: (productId) => `Compra revocada/reembolsada: ${productId}.`,
};

const APPLE_MESSAGE_BY_EVENT_TYPE = {
  SUBSCRIBED: (productId) => `Nueva suscripcion iOS: ${productId}.`,
  DID_RENEW: (productId) => `Renovacion iOS exitosa: ${productId}.`,
  EXPIRED: (productId) => `Suscripcion iOS expirada: ${productId}.`,
  DID_FAIL_TO_RENEW: () => 'Fallo de cobro en iOS durante renovacion.',
  REFUND: (productId) => `Reembolso Apple para ${productId}.`,
  REVOKE: (productId) => `Acceso revocado por Apple para ${productId}.`,
};

function translateGoogleEvent(notificationTypeCode, productId) {
  const eventType = GOOGLE_EVENT_TYPE_BY_CODE[notificationTypeCode] || `SUBSCRIPTION_UNKNOWN_${notificationTypeCode}`;
  const resolvedProductId = productId || UNKNOWN_PRODUCT_LABEL;
  const buildMessage = GOOGLE_MESSAGE_BY_EVENT_TYPE[eventType];
  const readableMessage = buildMessage
    ? buildMessage(resolvedProductId)
    : `Evento Android no mapeado (${eventType}) para ${resolvedProductId}.`;
  return { eventType, readableMessage };
}

function translateAppleEvent(notificationType, productId) {
  const resolvedProductId = productId || UNKNOWN_PRODUCT_LABEL;
  const buildMessage = APPLE_MESSAGE_BY_EVENT_TYPE[notificationType];
  const readableMessage = buildMessage
    ? buildMessage(resolvedProductId)
    : `Evento iOS no mapeado (${notificationType}) para ${resolvedProductId}.`;
  return { eventType: notificationType, readableMessage };
}

module.exports = {
  translateGoogleEvent,
  translateAppleEvent,
};
