const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { friendshipId, userId, action } = req.body || {};

    if (!friendshipId || !userId || !action) {
      return res.status(400).json({ error: 'friendshipId, userId and action are required' });
    }

    if (action !== 'accept' && action !== 'decline') {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      return res.status(404).json({ error: 'friendship not found' });
    }

    if (friendship.addresseeId !== userId) {
      return res.status(403).json({ error: 'only addressee can respond' });
    }

    const status = action === 'accept' ? 'accepted' : 'declined';

    const updatedFriendship = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status },
    });

    res.status(200).json({ ok: true, friendship: updatedFriendship });
  } catch (e) {
    console.error('Friend respond error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};