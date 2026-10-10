const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret, getOptionalUserId } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');

/**
 * POST|DELETE /api/alldecks/delete
 * Retira un deck propio de AllDecks (por id o por deckName). Es idempotente.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { userKey, id, deckName } = payload || {};
    if (!userKey || (!id && !deckName)) {
      return res.status(400).json({ error: 'userKey and id|deckName required' });
    }

    const jwtUserId = getOptionalUserId(req);
    const owner = jwtUserId
      ? { OR: [{ userKey }, { userId: jwtUserId }] }
      : { userKey };
    const result = await prisma.allDeck.deleteMany({
      where: id ? { id, ...owner } : { deckName, ...owner },
    });

    res.status(200).json({ ok: true, deleted: result.count });
  } catch (e) {
    console.error('❌ /api/alldecks/delete', e);
    res.status(500).json({ error: 'failed' });
  }
};
