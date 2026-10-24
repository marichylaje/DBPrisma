const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { sendServerError } = require('../../lib/httpError');

const MAX_DECKS = 500;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    // Solo los mazos del dueño del token; el userKey del cliente no se usa.
    const decks = await prisma.userDeck.findMany({
      where: { userKey: auth.userKey },
      orderBy: { updatedAt: 'desc' },
      take: MAX_DECKS,
    });

    const responseDecks = decks.map((deck) => ({
      ...deck,
      downloadCount: Number(deck.downloadCount ?? 0),
      sideboard: Array.isArray(deck.sideboard) ? deck.sideboard : [],
      commander: deck.commanderName
        ? { name: deck.commanderName, id: deck.commanderId }
        : null,
      partner: deck.partnerName
        ? { name: deck.partnerName, id: deck.partnerId }
        : null,
    }));

    res.status(200).json({ decks: responseDecks });
  } catch (e) {
    sendServerError(res, '/api/decks/list', e);
  }
};
