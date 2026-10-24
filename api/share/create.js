const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { parseOrReject, sharedDeckPayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    // Evita spam de mazos públicos compartidos desde una misma IP.
    const tiersOk = await checkRateLimitTiers(req, res, 'share-create', [
      { id: 'burst', limit: 8, windowSeconds: 10 },
      { id: 'sustained', limit: 20, windowSeconds: 600 },
    ]);
    if (!tiersOk) return;

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

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    const payload = parseOrReject(res, sharedDeckPayload, body);
    if (!payload) return;

    const {
      deckName,
      deckDescription = null,
      commander,
      commanderName: cName,
      commanderId: cId,
      partner,
      partnerName: pName,
      partnerId: pId,
      cards,
      sideboard,
      sharedType,
      tournamentId = null,
    } = payload;

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId;
    const finalPartnerName = partner?.name || pName;
    const finalPartnerId = partner?.id || pId;

    if (!finalCommanderName) {
      return res.status(400).json({ error: 'commander name is required' });
    }

    const { userKey, nickname } = await resolveOwnerRecord(auth);

    const created = await prisma.sharedDeck.create({
      data: {
        userKey,
        nickname,
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
    sendServerError(res, '/api/share/create', e);
  }
};
