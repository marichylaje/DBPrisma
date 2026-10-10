const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');

/**
 * POST /api/auth-sync/migrate-user-data
 * Migrates anonymous user data (decks, collection) to authenticated user
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    const { userId, userKey } = req.body || {};

    if (!userId || !userKey) {
      return res.status(400).json({ error: 'userId and userKey are required' });
    }

    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    // Migrate decks
    const decksUpdated = await prisma.userDeck.updateMany({
      where: {
        userKey,
        userId: null, // Only migrate decks not yet linked
      },
      data: {
        userId,
        nickname: user.nickname,
      },
    });

    const allDecksUpdated = await prisma.allDeck.updateMany({
      where: { userKey, userId: null },
      data: { userId, nickname: user.nickname },
    });

    // Migrate collection
    const collectionUpdated = await prisma.userCollection.updateMany({
      where: {
        userKey,
        userId: null,
      },
      data: {
        userId,
        nickname: user.nickname,
      },
    });

    res.status(200).json({
      ok: true,
      migrated: {
        decks: decksUpdated.count,
        allDecks: allDecksUpdated.count,
        collection: collectionUpdated.count,
      },
    });
  } catch (e) {
    console.error('❌ /api/auth-sync/migrate-user-data error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
