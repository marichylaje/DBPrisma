const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const userKey = String(req.query.userKey || '');
    if (!userKey) return res.status(400).json({ error: 'userKey required' });

    const decks = await prisma.userDeck.findMany({
      where: { userKey },
      orderBy: { updatedAt: 'desc' },
    });

    res.status(200).json({ decks });
  } catch (e) {
    console.error('❌ /api/decks/list', e);
    res.status(500).json({ error: 'failed' });
  }
};
