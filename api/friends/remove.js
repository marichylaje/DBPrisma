const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId, friendshipId } = req.body || {};

    if (!userId || !friendshipId) {
      return res.status(400).json({ error: 'userId and friendshipId are required' });
    }

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) {
      return res.status(404).json({ error: 'friendship not found' });
    }

    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await prisma.friendship.delete({ where: { id: friendshipId } });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Friend remove error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};