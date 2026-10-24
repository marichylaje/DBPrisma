const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { parseOrReject, collectionPayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, 'collection-save'))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    const payload = parseOrReject(res, collectionPayload, body);
    if (!payload) return;

    const { userKey, userId, nickname } = await resolveOwnerRecord(auth);
    // Vincular la colección con la cuenta permite que los amigos puedan consultarla.
    const ownerData = userId ? { userId } : {};

    const upserted = await prisma.userCollection.upsert({
      where: { userKey },
      create: {
        userKey,
        nickname,
        cards: payload.cards,
        ...ownerData,
      },
      update: {
        nickname,
        cards: payload.cards,
        ...ownerData,
      },
    });

    res.status(200).json({ ok: true, collection: upserted });
  } catch (e) {
    sendServerError(res, '/api/collection/save', e);
  }
};
