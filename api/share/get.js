const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const id = req.query.id ? String(req.query.id) : null;
    if (!id) {
      return res.status(400).json({ error: 'id required' });
    }

    const sharedDeck = await prisma.sharedDeck.findUnique({
      where: { id },
    });

    if (!sharedDeck) {
      return res.status(404).json({ error: 'not_found' });
    }

    // Check if the shared deck is older than 3 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    if (sharedDeck.createdAt < threeDaysAgo) {
      // Expired: Reactively delete it to clean up the DB
      try {
        await prisma.sharedDeck.delete({
          where: { id },
        });
        console.log(`🧹 Reactively deleted expired shared deck ID: ${id}`);
      } catch (deleteError) {
        console.error('❌ Failed reactive delete of expired deck:', deleteError);
      }
      return res.status(404).json({ error: 'expired' });
    }

    // Construct response object for frontend compatibility
    const responseShare = {
      ...sharedDeck,
      sideboard: Array.isArray(sharedDeck.sideboard) ? sharedDeck.sideboard : [],
      commander: { name: sharedDeck.commanderName, id: sharedDeck.commanderId },
      partner: sharedDeck.partnerName
        ? { name: sharedDeck.partnerName, id: sharedDeck.partnerId }
        : null,
    };

    res.status(200).json({ share: responseShare });
  } catch (e) {
    console.error('❌ /api/share/get', e);
    res.status(500).json({ error: 'failed' });
  }
};
