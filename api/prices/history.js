const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { cardKey } = req.query || {};

    if (!cardKey) {
      return res.status(400).json({ error: 'cardKey is required' });
    }

    const points = await prisma.cardPriceHistory.findMany({
      where: { cardKey },
      orderBy: { timestamp: 'asc' },
    });

    res.status(200).json({
      ok: true,
      history: points.map((p) => ({
        timestamp: new Date(p.timestamp).getTime(),
        priceUsd: p.priceUsd,
        priceEur: p.priceEur,
      })),
    });
  } catch (e) {
    console.error('❌ /api/prices/history', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
