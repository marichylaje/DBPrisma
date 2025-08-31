const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const userKey = String(req.query.userKey || '');
    const id = req.query.id ? String(req.query.id) : null;
    const deckName = req.query.deckName ? String(req.query.deckName) : null;
    if (!userKey) return res.status(400).json({ error: 'userKey required' });
    if (!id && !deckName) return res.status(400).json({ error: 'id or deckName required' });

    const deck = id
      ? await prisma.userDeck.findFirst({ where: { id, userKey } })
      : await prisma.userDeck.findUnique({ where: { userKey_deckName: { userKey, deckName } } });

    if (!deck) return res.status(404).json({ error: 'not_found' });
    res.status(200).json({ deck });
  } catch (e) {
    console.error('❌ /api/decks/get', e);
    res.status(500).json({ error: 'failed' });
  }
};
