const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

const MAX_ID_LENGTH = 64;

/**
 * GET /api/alldecks/get?id=<deckId>
 * Devuelve las cartas (cards + sideboard) de un deck de la galería pública. El listado
 * (`/api/alldecks/list?view=summary`) no las incluye: se piden sólo cuando el usuario abre el deck.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'alldecks-get', [
      { id: 'burst', limit: 20, windowSeconds: 10 },
      { id: 'sustained', limit: 600, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const id = String(req.query.id || '').trim();
    if (!id || id.length > MAX_ID_LENGTH) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const deck = await prisma.allDeck.findUnique({
      where: { id },
      select: { id: true, cards: true, sideboard: true },
    });
    if (!deck) return res.status(404).json({ error: 'not_found' });

    res.status(200).json({
      deck: {
        id: deck.id,
        cards: Array.isArray(deck.cards) ? deck.cards : [],
        sideboard: Array.isArray(deck.sideboard) ? deck.sideboard : [],
      },
    });
  } catch (e) {
    sendServerError(res, '/api/alldecks/get', e);
  }
};
