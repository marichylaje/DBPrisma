const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

const MAX_BATCH_SIZE = 100;

function truncate(value, maxLength = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeProperties(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function sanitizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return null;
  }

  const eventName = truncate(rawEvent.eventName, 120);
  const sessionId = truncate(rawEvent.sessionId, 120);
  const userKey = truncate(rawEvent.userKey, 120);
  const platform = truncate(rawEvent.platform, 40);
  const appVersion = truncate(rawEvent.appVersion, 40);
  const occurredAt = new Date(rawEvent.occurredAt);

  if (
    !eventName ||
    !sessionId ||
    !userKey ||
    !platform ||
    !appVersion ||
    Number.isNaN(occurredAt.getTime())
  ) {
    return null;
  }

  return {
    appVersion,
    eventName,
    flowName: truncate(rawEvent.flowName, 120),
    isPaidUser:
      typeof rawEvent.isPaidUser === 'boolean' ? rawEvent.isPaidUser : null,
    language: truncate(rawEvent.language, 40),
    occurredAt,
    platform,
    properties: normalizeProperties(rawEvent.properties),
    region: truncate(rawEvent.region, 40),
    role: truncate(rawEvent.role, 40),
    screenName: truncate(rawEvent.screenName, 120),
    sessionId,
    userKey,
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { events } = req.body || {};
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'events must be an array' });
    }

    const batch = events.slice(0, MAX_BATCH_SIZE);
    const sanitizedEvents = batch.map(sanitizeEvent).filter(Boolean);

    if (sanitizedEvents.length === 0) {
      return res.status(200).json({
        accepted: 0,
        ignored: batch.length,
        ok: true,
      });
    }

    await prisma.analyticsEvent.createMany({
      data: sanitizedEvents,
    });

    return res.status(200).json({
      accepted: sanitizedEvents.length,
      ignored: batch.length - sanitizedEvents.length,
      ok: true,
    });
  } catch (e) {
    console.error('❌ /api/analytics/track', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
