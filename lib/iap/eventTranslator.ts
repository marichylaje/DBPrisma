// lib/iap/eventTranslator.ts
// Traduce las notificaciones técnicas de IAP (Google Play RTDN / Apple App Store Server
// Notifications V2) a mensajes legibles en español, para reenviarlos al panel de
// MTGEventTracking (lib/iap/eventTrackingService.ts).

export type EventTrackingPlatform = 'ANDROID' | 'IOS';

export interface TranslatedIapEvent {
  eventType: string;
  readableMessage: string;
}

type MessageBuilder = (productId: string) => string;

const UNKNOWN_PRODUCT_LABEL = 'desconocido';

// Google Play Real-time Developer Notifications: subscriptionNotification.notificationType
// llega como número (1-13). Ver https://developer.android.com/google/play/billing/rtdn-reference
const GOOGLE_EVENT_TYPE_BY_CODE: Record<number, string> = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
};

const GOOGLE_MESSAGE_BY_EVENT_TYPE: Record<string, MessageBuilder> = {
  SUBSCRIPTION_PURCHASED: (productId) => `🎉 ¡Nueva suscripción! Un usuario ha contratado el plan ${productId}.`,
  SUBSCRIPTION_RENEWED: (productId) => `🔄 Renovación exitosa. Se ha cobrado el periodo del plan ${productId}.`,
  SUBSCRIPTION_RECOVERED: (productId) => `💚 Pago recuperado. El usuario corrigió su método de pago para ${productId}.`,
  SUBSCRIPTION_CANCELED: (productId) => `⚠️ Cancelación programada. El usuario canceló la renovación automática de ${productId}.`,
  SUBSCRIPTION_IN_GRACE_PERIOD: (productId) => `⚡ Problema de cobro. La tarjeta falló, usuario en período de gracia para ${productId}.`,
  SUBSCRIPTION_ON_HOLD: (productId) => `⏸️ Suscripción pausada. Falta de pago prolongada en ${productId}.`,
  SUBSCRIPTION_EXPIRED: (productId) => `🚫 Suscripción expirada. El usuario perdió el acceso Pro a ${productId}.`,
  SUBSCRIPTION_REVOKED: (productId) => `💸 Reembolso/Revocación. Se ha reembolsado la compra de ${productId}.`,
};

// Apple App Store Server Notifications V2: notification.notificationType ya llega como string.
// Ver https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
const APPLE_MESSAGE_BY_EVENT_TYPE: Record<string, MessageBuilder> = {
  SUBSCRIBED: (productId) => `🎉 ¡Nueva suscripción en iOS! Usuario registrado en ${productId}.`,
  DID_RENEW: (productId) => `🔄 Renovación exitosa en iOS para el plan ${productId}.`,
  EXPIRED: (productId) => `🚫 Suscripción expirada en iOS para ${productId}.`,
  DID_FAIL_TO_RENEW: () => `⚡ Fallo de cobro en iOS. El intento de renovación falló.`,
  REFUND: (productId) => `💸 Reembolso procesado por Apple para ${productId}.`,
  REVOKE: (productId) => `🚫 Acceso revocado por Apple para ${productId}.`,
};

/** Mapea un notificationType numérico de Google Play (RTDN) a un mensaje claro en español. */
export function translateGoogleEvent(notificationTypeCode: number, productId?: string | null): TranslatedIapEvent {
  const eventType = GOOGLE_EVENT_TYPE_BY_CODE[notificationTypeCode] || `SUBSCRIPTION_UNKNOWN_${notificationTypeCode}`;
  const resolvedProductId = productId || UNKNOWN_PRODUCT_LABEL;
  const buildMessage = GOOGLE_MESSAGE_BY_EVENT_TYPE[eventType];
  const readableMessage = buildMessage
    ? buildMessage(resolvedProductId)
    : `ℹ️ Evento de suscripción Android no mapeado (${eventType}) para ${resolvedProductId}.`;
  return { eventType, readableMessage };
}

/** Mapea un notificationType de Apple (App Store Server Notifications V2) a un mensaje claro en español. */
export function translateAppleEvent(notificationType: string, productId?: string | null): TranslatedIapEvent {
  const resolvedProductId = productId || UNKNOWN_PRODUCT_LABEL;
  const buildMessage = APPLE_MESSAGE_BY_EVENT_TYPE[notificationType];
  const readableMessage = buildMessage
    ? buildMessage(resolvedProductId)
    : `ℹ️ Evento de suscripción iOS no mapeado (${notificationType}) para ${resolvedProductId}.`;
  return { eventType: notificationType, readableMessage };
}
