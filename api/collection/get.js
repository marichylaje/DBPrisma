const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userKey } = req.query || {};

    if (!userKey) {
      return res.status(400).json({ error: 'userKey is required' });
    }

    const collection = await prisma.userCollection.findUnique({
      where: { userKey },
    });

    res.status(200).json({
      ok: true,
      cards: collection ? collection.cards : [],
    });
  } catch (e) {
    console.error('âŒ /api/collection/get', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

