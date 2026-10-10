const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret, getOptionalUserId } = require('../../lib/auth');
const { lookupNicknames } = require('../../lib/userLookup');

const DEFAULT_MIN_CARDS = 97;
const DEFAULT_MAX_CARDS = 103;

function parseIntParam(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * GET /api/alldecks/list?minCards=97&maxCards=103&limit=
 * Devuelve únicamente los decks cuyo cardCount está dentro del rango (filtrado en la DB).
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const minCards = parseIntParam(req.query.minCards, DEFAULT_MIN_CARDS);
    const maxCards = parseIntParam(req.query.maxCards, DEFAULT_MAX_CARDS);
    const limit = parseIntParam(req.query.limit, 0);
    const userKeys = String(req.query.userKeys || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);

    const jwtUserId = getOptionalUserId(req);

    const decks = await prisma.allDeck.findMany({
      where: {
        cardCount: { gte: minCards, lte: maxCards },
        ...(userKeys.length
          ? {
              OR: [
                { userKey: { in: userKeys } },
                ...(jwtUserId ? [{ userId: jwtUserId }] : []),
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      ...(limit > 0 ? { take: Math.min(limit, 1000) } : {}),
    });

    // Decks sin nickname guardado (p. ej. usuario que se registró después de compartir).
    const missing = decks
      .filter((deck) => !deck.nickname)
      .map((deck) => deck.userId || deck.userKey);
    const nicknames = await lookupNicknames(missing);

    const responseDecks = decks.map((deck) => ({
      ...deck,
      nickname:
        deck.nickname ?? nicknames.get(deck.userId || deck.userKey) ?? null,
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
    console.error('❌ /api/alldecks/list', e);
    res.status(500).json({ error: 'failed' });
  }
};
