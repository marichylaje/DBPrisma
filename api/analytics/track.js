const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { decodeVerifiedToken, parseBearerToken } = require('../../lib/auth');
const { lookupNicknames } = require('../../lib/userLookup');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

const MAX_BATCH_SIZE = 100;
const MAX_PROPERTIES_BYTES = 4000;

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
  // Evita que un cliente almacene JSON arbitrariamente grande.
  return JSON.stringify(value).length > MAX_PROPERTIES_BYTES ? {} : value;
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
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'analytics-track', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 600, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const { events } = req.body || {};
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'events must be an array' });
    }

    // Si hay sesión válida, el userKey sale del token (no se puede suplantar a otro usuario).
    const caller = decodeVerifiedToken(parseBearerToken(req));

    const batch = events.slice(0, MAX_BATCH_SIZE);
    const sanitizedEvents = batch
      .map(sanitizeEvent)
      .filter(Boolean)
      .map((e) => (caller ? { ...e, userKey: caller.sub } : e));

    if (sanitizedEvents.length === 0) {
      return res.status(200).json({
        accepted: 0,
        ignored: batch.length,
        ok: true,
      });
    }

    // Desnormalizado: si userKey resulta ser el id de un usuario registrado, guardamos su
    // nickname para poder leerlo rápido al revisar la tabla manualmente (no afecta la lógica).
    const nicknameByKey = await lookupNicknames(sanitizedEvents.map((e) => e.userKey));
    const eventsWithNickname = sanitizedEvents.map((e) => ({
      ...e,
      nickname: nicknameByKey.get(e.userKey) || null,
    }));

    await prisma.analyticsEvent.createMany({
      data: eventsWithNickname,
    });

    return res.status(200).json({
      accepted: sanitizedEvents.length,
      ignored: batch.length - sanitizedEvents.length,
      ok: true,
    });
  } catch (e) {
    return sendServerError(res, '/api/analytics/track', e);
  }
};

