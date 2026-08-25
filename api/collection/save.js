const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userKey, cards } = req.body || {};

    if (!userKey) {
      return res.status(400).json({ error: 'userKey is required' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
    }

    const upserted = await prisma.userCollection.upsert({
      where: { userKey },
      create: {
        userKey,
        cards,
      },
      update: {
        cards,
      },
    });

    res.status(200).json({ ok: true, collection: upserted });
  } catch (e) {
    console.error('âŒ /api/collection/save', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

