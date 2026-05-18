const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    // Reactive database cleanup: delete rows older than 3 days
    try {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const deleteResult = await prisma.sharedDeck.deleteMany({
        where: {
          createdAt: {
            lt: threeDaysAgo,
          },
        },
      });
      if (deleteResult.count > 0) {
        console.log(`🧹 Cleaned up ${deleteResult.count} expired shared decks.`);
      }
    } catch (cleanupError) {
      console.error('❌ Failed reactive cleanup of shared decks:', cleanupError);
    }

    const {
      userKey = null,
      deckName,
      deckDescription = null,
      commander = {},
      partner = null,
      cards = [],
      sharedType = 'QR',
      tournamentId = null,
    } = req.body || {};

    if (!deckName) {
      return res.status(400).json({ error: 'deckName is required' });
    }
    if (!commander?.name) {
      return res.status(400).json({ error: 'commander name is required' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
    }

    const created = await prisma.sharedDeck.create({
      data: {
        userKey,
        deckName,
        deckDescription,
        commanderName: commander.name,
        commanderId: commander.id || null,
        partnerName: partner?.name || null,
        partnerId: partner?.id || null,
        cards,
        sharedType,
        tournamentId,
      },
    });

    res.status(200).json({ ok: true, share: created });
  } catch (e) {
    console.error('❌ /api/share/create', e);
    res.status(500).json({ error: 'failed' });
  }
};
