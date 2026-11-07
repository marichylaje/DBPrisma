const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { decodeVerifiedToken, parseBearerToken } = require('../../lib/auth');
const { lookupNicknames } = require('../../lib/userLookup');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

const crypto = require('node:crypto');

const DEFAULT_MIN_CARDS = 97;
const DEFAULT_MAX_CARDS = 103;
const MAX_LIMIT = 1000;
const MAX_USER_KEYS = 100;
const DEFAULT_PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 64;

function parseIntParam(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Debe coincidir (aprox.) con normalizeImportedCardName del cliente.
function normalizeCardName(value) {
  return String(value ?? '')
    .split('|')[0]
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\u2019\u2018]/g, "'");
}

function entriesKey(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ name: normalizeCardName(entry?.name), count: Number(entry?.count) || 0 }))
    .filter((entry) => entry.name && entry.count > 0)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => `${entry.name}:${entry.count}`)
    .join('|');
}

/** Hash de la composición del deck: permite deduplicar en el cliente sin enviar las cartas. */
function compositionHash(deck) {
  const signature = [
    `cmdr=${normalizeCardName(deck.commanderName)}`,
    `partner=${normalizeCardName(deck.partnerName)}`,
    `main=${entriesKey(deck.cards)}`,
    `sb=${entriesKey(deck.sideboard)}`,
  ].join(';');
  return crypto.createHash('sha1').update(signature).digest('hex');
}

function buildWhere({ minCards, maxCards, userKeys, callerUserId }) {
  return {
    cardCount: { gte: minCards, lte: maxCards },
    ...(userKeys.length
      ? {
          OR: [
            { userKey: { in: userKeys } },
            ...(callerUserId ? [{ userId: callerUserId }] : []),
          ],
        }
      : {}),
  };
}

/**
 * Modo paginado y liviano (`view=summary`): no envía cards/sideboard, sólo un `compositionHash`.
 * Las cartas se piden por deck con /api/alldecks/get cuando el usuario lo abre.
 * Orden: más descargados primero; paginación por cursor (id del último deck recibido).
 */
async function handleSummary(req, res, filters) {
  const pageSize = Math.min(
    Math.max(parseIntParam(req.query.limit, DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE,
  );
  const cursor = String(req.query.cursor || '').trim();
  if (cursor.length > MAX_CURSOR_LENGTH) {
    return res.status(400).json({ error: 'invalid_cursor' });
  }

  const rows = await prisma.allDeck.findMany({
    where: buildWhere(filters),
    orderBy: [{ downloadCount: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      userKey: true,
      userId: true,
      nickname: true,
      deckName: true,
      deckDescription: true,
      instagram: true,
      commanderName: true,
      commanderId: true,
      partnerName: true,
      partnerId: true,
      cards: true,
      sideboard: true,
      cardCount: true,
      downloadCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const missing = page
    .filter((deck) => !deck.nickname)
    .map((deck) => deck.userId || deck.userKey);
  const nicknames = await lookupNicknames(missing);

  const decks = page.map(({ cards, sideboard, userId, ...deck }) => ({
    ...deck,
    nickname: deck.nickname ?? nicknames.get(userId || deck.userKey) ?? null,
    downloadCount: Number(deck.downloadCount ?? 0),
    compositionHash: compositionHash({ ...deck, cards, sideboard }),
  }));

  return res.status(200).json({
    decks,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

/**
 * GET /api/alldecks/list?minCards=97&maxCards=103&limit=
 * GET /api/alldecks/list?view=summary&limit=40&cursor=<id>   (paginado, sin cartas)
 * Galería pública de mazos compartidos (no requiere sesión). Si la petición trae un token válido,
 * `userKeys` también incluye los mazos de esa cuenta.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const isSummary = String(req.query.view || '') === 'summary';

    // Las páginas del modo summary son livianas y se piden en ráfaga: bucket propio y más amplio.
    const rateOk = isSummary
      ? await checkRateLimitTiers(req, res, 'alldecks-list-page', [
          { id: 'burst', limit: 30, windowSeconds: 10 },
          { id: 'sustained', limit: 3000, windowSeconds: 3600 },
        ])
      : await checkRateLimitTiers(req, res, 'alldecks-list', [
          { id: 'burst', limit: 10, windowSeconds: 10 },
          { id: 'sustained', limit: 300, windowSeconds: 3600 },
        ]);
    if (!rateOk) return;

    const minCards = parseIntParam(req.query.minCards, DEFAULT_MIN_CARDS);
    const maxCards = parseIntParam(req.query.maxCards, DEFAULT_MAX_CARDS);
    const userKeys = String(req.query.userKeys || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .slice(0, MAX_USER_KEYS);

    const caller = decodeVerifiedToken(parseBearerToken(req));
    const callerUserId = caller && caller.kind === 'user' ? caller.sub : null;

    if (isSummary) {
      return await handleSummary(req, res, { minCards, maxCards, userKeys, callerUserId });
    }

    const limit = parseIntParam(req.query.limit, 0);
    const take = limit > 0 ? Math.min(limit, MAX_LIMIT) : MAX_LIMIT;

    // Modo legacy (versiones viejas de la app): todo de una vez, con cartas.
    const decks = await prisma.allDeck.findMany({
      where: buildWhere({ minCards, maxCards, userKeys, callerUserId }),
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
