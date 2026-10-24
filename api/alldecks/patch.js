const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { parseOrReject, deckPatchPayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, 'alldecks-patch'))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    const payload = parseOrReject(res, deckPatchPayload, body);
    if (!payload) return;

    const { id, deckDescription, instagram } = payload;

    const existing = await prisma.allDeck.findFirst({
      where: {
        id,
        OR: [{ userKey: auth.userKey }, ...(auth.userId ? [{ userId: auth.userId }] : [])],
      },
    });
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    const updated = await prisma.allDeck.update({
      where: { id: existing.id },
      data: {
        deckDescription: deckDescription !== undefined ? deckDescription : existing.deckDescription,
        instagram: instagram !== undefined ? instagram : existing.instagram,
      },
    });

    res.status(200).json({ ok: true, deck: updated });
  } catch (e) {
    sendServerError(res, '/api/alldecks/patch', e);
  }
};
