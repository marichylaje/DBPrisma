const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

// Lectura pública por id (cuid no enumerable) para mazos compartidos por QR; expira a los 3 días.
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'share-get', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 200, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const id = typeof req.query.id === 'string' && req.query.id ? req.query.id : null;
    if (!id || id.length > 64) {
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
    sendServerError(res, '/api/share/get', e);
  }
};
