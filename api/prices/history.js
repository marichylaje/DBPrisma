const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

// Historial de precios de cartas: dato público (no pertenece a ningún usuario).
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'prices-history', [
      { id: 'burst', limit: 20, windowSeconds: 10 },
      { id: 'sustained', limit: 600, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const cardKey = typeof req.query?.cardKey === 'string' ? req.query.cardKey : '';

    if (!cardKey || cardKey.length > 200) {
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
    sendServerError(res, '/api/prices/history', e);
  }
};
