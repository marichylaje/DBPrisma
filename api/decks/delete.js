const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userKey, id, deckName } = req.body || {};
    if (!userKey || (!id && !deckName)) {
      return res.status(400).json({ error: 'userKey and id|deckName required' });
    }

    const where = id
      ? { id, userKey }
      : { userKey_deckName: { userKey, deckName } };

    // necesitamos dos ramas porque el where compuesto no aplica a deleteMany
    if (id) {
      await prisma.userDeck.delete({ where });
    } else {
      await prisma.userDeck.delete({ where });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('❌ /api/decks/delete', e);
    res.status(500).json({ error: 'failed' });
  }
};
