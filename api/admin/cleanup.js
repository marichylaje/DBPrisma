const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkAdminSecret } = require('../../lib/auth');
const { sendServerError } = require('../../lib/httpError');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Limpieza periódica (Vercel Cron, GET con `Authorization: Bearer <CRON_SECRET>`).
 * Evita el crecimiento indefinido de tablas efímeras / de telemetría.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!checkAdminSecret(req, res)) return;

  try {
    const now = Date.now();
    const [rateLimit, analytics, sharedDecks, iapTracking] = await Promise.all([
      prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * DAY_MS) } } }),
      prisma.analyticsEvent.deleteMany({ where: { occurredAt: { lt: new Date(now - 90 * DAY_MS) } } }),
      prisma.sharedDeck.deleteMany({ where: { createdAt: { lt: new Date(now - 3 * DAY_MS) } } }),
      prisma.iapTrackingEvent.deleteMany({ where: { occurredAt: { lt: new Date(now - 180 * DAY_MS) } } }),
    ]);

    res.json({
      ok: true,
      deleted: {
        rateLimitHit: rateLimit.count,
        analyticsEvent: analytics.count,
        sharedDeck: sharedDecks.count,
        iapTrackingEvent: iapTracking.count,
      },
    });
  } catch (e) {
    sendServerError(res, '/api/admin/cleanup', e);
  }
};
