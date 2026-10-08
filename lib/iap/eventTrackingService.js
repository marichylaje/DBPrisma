const { logIapEvent } = require('../iapLogger');

const EVENT_SOURCE = 'MTGCommanderDeckBuilder';
const SEND_TIMEOUT_MS = 5000;

async function sendToEventTracking(eventPayload) {
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
    userId: eventPayload.userId || null,
    productId: eventPayload.productId || null,
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
      error: String((e && e.message) || e),
      eventType: body.eventType,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = {
  sendToEventTracking,
};
