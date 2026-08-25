const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST' && req.method !== 'PATCH') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { id, userKey, deckDescription, instagram } = req.body || {};
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
    console.error('âŒ /api/decks/patch', e);
    res.status(500).json({ error: 'failed' });
  }
};

