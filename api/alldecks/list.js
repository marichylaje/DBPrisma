const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { decodeVerifiedToken, parseBearerToken } = require('../../lib/auth');
const { lookupNicknames } = require('../../lib/userLookup');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

const DEFAULT_MIN_CARDS = 97;
const DEFAULT_MAX_CARDS = 103;
const MAX_LIMIT = 1000;
const MAX_USER_KEYS = 100;

function parseIntParam(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * GET /api/alldecks/list?minCards=97&maxCards=103&limit=
 * Galería pública de mazos compartidos (no requiere sesión). Si la petición trae un token válido,
 * `userKeys` también incluye los mazos de esa cuenta.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'alldecks-list', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 300, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const minCards = parseIntParam(req.query.minCards, DEFAULT_MIN_CARDS);
    const maxCards = parseIntParam(req.query.maxCards, DEFAULT_MAX_CARDS);
    const limit = parseIntParam(req.query.limit, 0);
    const take = limit > 0 ? Math.min(limit, MAX_LIMIT) : MAX_LIMIT;
    const userKeys = String(req.query.userKeys || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .slice(0, MAX_USER_KEYS);

    const caller = decodeVerifiedToken(parseBearerToken(req));
    const callerUserId = caller && caller.kind === 'user' ? caller.sub : null;

    const decks = await prisma.allDeck.findMany({
      where: {
        cardCount: { gte: minCards, lte: maxCards },
        ...(userKeys.length
          ? {
              OR: [
                { userKey: { in: userKeys } },
                ...(callerUserId ? [{ userId: callerUserId }] : []),
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take,
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
    sendServerError(res, '/api/alldecks/list', e);
  }
};
