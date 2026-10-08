// lib/iap/eventTrackingService.ts
// Reenvía eventos de IAP (ya traducidos a lenguaje claro por eventTranslator.ts) al webhook
// de la app MTGEventTracking, para que los persista en su base de datos y los muestre en su
// panel. Pensado para NUNCA romper el procesamiento del webhook de origen (Google/Apple):
// cualquier fallo de configuración, red, autenticación o timeout se registra como log
// estructurado (lib/iapLogger.js) y se descarta, sin lanzar excepciones hacia quien la invoca.
import { logIapEvent } from '../iapLogger';
import type { EventTrackingPlatform } from './eventTranslator';

const EVENT_SOURCE = 'MTGCommanderDeckBuilder';
const SEND_TIMEOUT_MS = 5000;

export interface EventTrackingPayload {
  platform: EventTrackingPlatform;
  eventType: string;
  readableMessage: string;
  userId?: string | null;
  productId?: string | null;
  timestamp?: string;
}

export async function sendToEventTracking(eventPayload: EventTrackingPayload): Promise<void> {
  const url = process.env.EVENT_TRACKING_API_URL;
  const apiKey = process.env.EVENT_TRACKING_API_KEY;

  if (!url || !apiKey) {
    logIapEvent({ level: 'warn', source: 'event-tracking', event: 'config_missing' });
    return;
  }

  const body = {
    source: EVENT_SOURCE,
    platform: eventPayload.platform,
    eventType: eventPayload.eventType,
    readableMessage: eventPayload.readableMessage,
    userId: eventPayload.userId ?? null,
    productId: eventPayload.productId ?? null,
    timestamp: eventPayload.timestamp || new Date().toISOString(),
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logIapEvent({
        level: 'error',
        source: 'event-tracking',
        event: 'send_failed',
        status: response.status,
        body: text.slice(0, 500),
        eventType: body.eventType,
      });
    }
  } catch (e) {
    logIapEvent({
      level: 'error',
      source: 'event-tracking',
      event: 'send_error',
      error: String((e as Error)?.message || e),
      eventType: body.eventType,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}
