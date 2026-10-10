const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { resolveOwner } = require('../../lib/userLookup');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { userKey, cards } = payload || {};

    if (!userKey) {
      return res.status(400).json({ error: 'userKey is required' });
    }
    if (!Array.isArray(cards) || cards.some((name) => typeof name !== 'string')) {
      return res.status(400).json({ error: 'cards must be an array of strings' });
    }

    const owner = await resolveOwner(req, userKey);
    const nickname = owner?.nickname ?? null;
    const ownerData = owner ? { userId: owner.id } : {};

    await prisma.userWishlist.upsert({
      where: { userKey },
      create: { userKey, nickname, cards, ...ownerData },
      update: { nickname, cards, ...ownerData },
    });

    res.status(200).json({ ok: true, count: cards.length });
  } catch (e) {
    console.error('❌ /api/wishlist/save', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
