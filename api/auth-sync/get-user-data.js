const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

/**
 * GET /api/auth-sync/get-user-data
 * Returns all user data: profile, decks, collection
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Get user with all related data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        email: true,
        role: true,
        xp: true,
        level: true,
        storeName: true,
        storeAddress: true,
        createdAt: true,
        decks: {
          select: {
            id: true,
            userKey: true,
            deckName: true,
            deckDescription: true,
            instagram: true,
            commanderName: true,
            commanderId: true,
            partnerName: true,
            partnerId: true,
            cards: true,
            sideboard: true,
            downloadCount: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        collection: {
          select: {
            userKey: true,
            cards: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    res.status(200).json({ ok: true, user });
  } catch (e) {
    console.error('❌ /api/auth-sync/get-user-data error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
