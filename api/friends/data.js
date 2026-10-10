const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');

const TYPES = new Set(['collection', 'wishlist', 'decks']);

function latestCards(rows) {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  const first = sorted[0];
  return first && Array.isArray(first.cards) ? first.cards : [];
}

function mapDeck(deck) {
  return {
    id: deck.id,
    deckName: deck.deckName,
    deckDescription: deck.deckDescription ?? null,
    commanderName: deck.commanderName,
    partnerName: deck.partnerName ?? null,
    cards: Array.isArray(deck.cards) ? deck.cards : [],
    sideboard: Array.isArray(deck.sideboard) ? deck.sideboard : [],
    updatedAt: deck.updatedAt,
  };
}

/**
 * GET /api/friends/data?userId=<me>&friendId=<friend>&type=collection|wishlist|decks
 * Solo disponible entre amigos con la amistad aceptada.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    const { userId, friendId, type } = req.query || {};

    if (typeof userId !== 'string' || !userId || typeof friendId !== 'string' || !friendId) {
      return res.status(400).json({ error: 'userId and friendId are required' });
    }
    if (typeof type !== 'string' || !TYPES.has(type)) {
      return res.status(400).json({ error: 'type must be collection, wishlist or decks' });
    }
    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const friendship = await prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, addresseeId: friendId },
          { requesterId: friendId, addresseeId: userId },
        ],
      },
      select: { id: true },
    });

    if (!friendship) {
      return res.status(403).json({ error: 'forbidden_not_friends' });
    }

    const owner = { OR: [{ userId: friendId }, { userKey: friendId }] };

    if (type === 'collection') {
      const rows = await prisma.userCollection.findMany({ where: owner });
      return res.status(200).json({ ok: true, type, cards: latestCards(rows) });
    }

    if (type === 'wishlist') {
      const rows = await prisma.userWishlist.findMany({ where: owner });
      return res.status(200).json({ ok: true, type, cards: latestCards(rows) });
    }

    const [userDecks, allDecks] = await Promise.all([
      prisma.userDeck.findMany({ where: owner }),
      prisma.allDeck.findMany({ where: owner }),
    ]);

    // Mismo nombre en ambas tablas: se conserva la versión más reciente.
    const byName = new Map();
    for (const deck of [...userDecks, ...allDecks]) {
      const key = deck.deckName.trim().toLowerCase();
      const current = byName.get(key);
      if (!current || new Date(deck.updatedAt) > new Date(current.updatedAt)) {
        byName.set(key, deck);
      }
    }

    const decks = [...byName.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(mapDeck);

    res.status(200).json({ ok: true, type, decks });
  } catch (e) {
    console.error('Friend data error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
