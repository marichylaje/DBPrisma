const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
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
        console.log(`ðŸ§¹ Cleaned up ${deleteResult.count} expired shared decks.`);
      }
    } catch (cleanupError) {
      console.error('âŒ Failed reactive cleanup of shared decks:', cleanupError);
    }

    const {
      userKey = null,
      deckName,
      deckDescription = null,
      commander = {},
      commanderName: cName,
      commanderId: cId,
      partner = null,
      partnerName: pName,
      partnerId: pId,
      cards = [],
      sideboard = [],
      sharedType = 'QR',
      tournamentId = null,
    } = req.body || {};

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId;
    const finalPartnerName = partner?.name || pName;
    const finalPartnerId = partner?.id || pId;

    if (!deckName) {
      return res.status(400).json({ error: 'deckName is required' });
    }
    if (!finalCommanderName) {
      return res.status(400).json({ error: 'commander name is required' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
    }
    if (!Array.isArray(sideboard)) {
      return res.status(400).json({ error: 'sideboard must be an array' });
    }

    const created = await prisma.sharedDeck.create({
      data: {
        userKey,
        deckName,
        deckDescription,
        commanderName: finalCommanderName,
        commanderId: finalCommanderId ?? null,
        partnerName: finalPartnerName ?? null,
        partnerId: finalPartnerId ?? null,
        cards,
        sideboard,
        sharedType,
        tournamentId,
      },
    });

    res.status(200).json({ ok: true, share: created });
  } catch (e) {
    console.error('âŒ /api/share/create', e);
    res.status(500).json({ error: 'failed' });
  }
};

