const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { requesterId, addresseeId } = req.body || {};

    if (!requesterId || !addresseeId) {
      return res.status(400).json({ error: 'requesterId and addresseeId are required' });
    }

    if (requesterId === addresseeId) {
      return res.status(400).json({ error: 'requesterId and addresseeId must be different' });
    }

    const [requester, addressee] = await Promise.all([
      prisma.user.findUnique({ where: { id: requesterId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: addresseeId }, select: { id: true } }),
    ]);

    if (!requester) {
      return res.status(404).json({ error: 'requester user not found' });
    }

    if (!addressee) {
      return res.status(404).json({ error: 'addressee user not found' });
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    if (existing?.status === 'accepted') {
      return res.status(400).json({ error: 'already friends' });
    }

    if (existing?.status === 'pending') {
      return res.status(400).json({ error: 'request already pending' });
    }

    const friendship = await prisma.$transaction(async (tx) => {
      if (existing?.status === 'declined') {
        await tx.friendship.delete({ where: { id: existing.id } });
      }

      return tx.friendship.create({
        data: {
          requesterId,
          addresseeId,
          status: 'pending',
        },
      });
    });

    res.status(200).json({ ok: true, friendship });
  } catch (e) {
    console.error('Friend request error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
