const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { id, userKey, deckDescription, instagram } = payload || {};
    if (!id || !userKey) {
      return res.status(400).json({ error: 'id and userKey are required' });
    }

    // Verify ownership before allowing edit
    const existing = await prisma.userDeck.findFirst({ where: { id, userKey } });
    if (!existing) {
      return res.status(403).json({ error: 'not found or unauthorized' });
    }

    const updated = await prisma.userDeck.update({
      where: { id },
      data: {
        deckDescription: deckDescription !== undefined ? deckDescription : existing.deckDescription,
        instagram: instagram !== undefined ? instagram : existing.instagram,
      },
    });

    res.status(200).json({ ok: true, deck: updated });
  } catch (e) {
    console.error('❌ /api/decks/patch', e);
    res.status(500).json({ error: 'failed' });
  }
};

