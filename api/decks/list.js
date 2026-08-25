const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const userKey = String(req.query.userKey || '');

    const decks = await prisma.userDeck.findMany({
      where: userKey ? { userKey } : undefined,
      orderBy: { updatedAt: 'desc' },
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
    console.error('âŒ /api/decks/list', e);
    res.status(500).json({ error: 'failed' });
  }
};

