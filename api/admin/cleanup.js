const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkAdminSecret } = require('../../lib/auth');
const { sendServerError } = require('../../lib/httpError');

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_HISTORY_RETENTION_DAYS = 90;

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
    const activeCollections = await prisma.userCollection.findMany({
      select: { cards: true },
    });
    const activeCardKeys = new Set();
    for (const collection of activeCollections) {
      if (!Array.isArray(collection.cards)) continue;
      for (const cardKey of collection.cards) {
        if (typeof cardKey === 'string' && cardKey.trim()) {
          activeCardKeys.add(cardKey.trim());
        }
      }
    }

    const stalePriceHistoryBefore = new Date(
      now - PRICE_HISTORY_RETENTION_DAYS * DAY_MS,
    );
    const stalePriceHistory = await prisma.cardPriceHistory.findMany({
      where: { updatedAt: { lt: stalePriceHistoryBefore } },
      select: { cardKey: true },
    });
    const inactivePriceKeys = stalePriceHistory
      .map((record) => record.cardKey)
      .filter((cardKey) => !activeCardKeys.has(cardKey));

    const [
      rateLimit,
      analytics,
      sharedDecks,
      iapTracking,
      authEmailChallenges,
    ] = await Promise.all([
      prisma.rateLimitHit.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * DAY_MS) } } }),
      prisma.analyticsEvent.deleteMany({ where: { occurredAt: { lt: new Date(now - 90 * DAY_MS) } } }),
      prisma.sharedDeck.deleteMany({ where: { createdAt: { lt: new Date(now - 3 * DAY_MS) } } }),
      prisma.iapTrackingEvent.deleteMany({ where: { occurredAt: { lt: new Date(now - 180 * DAY_MS) } } }),
      prisma.authEmailChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    ]);
    let deletedPriceHistory = 0;
    for (let i = 0; i < inactivePriceKeys.length; i += 500) {
      const deleted = await prisma.cardPriceHistory.deleteMany({
        where: { cardKey: { in: inactivePriceKeys.slice(i, i + 500) } },
      });
      deletedPriceHistory += deleted.count;
    }

    res.json({
      ok: true,
      deleted: {
        rateLimitHit: rateLimit.count,
        analyticsEvent: analytics.count,
        sharedDeck: sharedDecks.count,
        iapTrackingEvent: iapTracking.count,
        authEmailChallenge: authEmailChallenges.count,
        cardPriceHistory: deletedPriceHistory,
      },
      activePriceCardKeys: activeCardKeys.size,
    });
  } catch (e) {
    sendServerError(res, '/api/admin/cleanup', e);
  }
};
