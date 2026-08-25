const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { cardKey } = req.query || {};

    if (!cardKey) {
      return res.status(400).json({ error: 'cardKey is required' });
    }

    const record = await prisma.cardPriceHistory.findUnique({
      where: { cardKey },
    });

    res.status(200).json({
      ok: true,
      history: record && Array.isArray(record.history) ? record.history : [],
    });
  } catch (e) {
    console.error('âŒ /api/prices/history', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

