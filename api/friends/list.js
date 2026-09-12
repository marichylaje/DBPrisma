const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId } = req.query || {};

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const [acceptedFriendships, incomingPending, outgoingPending] = await Promise.all([
      prisma.friendship.findMany({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: userId },
            { addresseeId: userId },
          ],
        },
        include: {
          requester: {
            select: {
              id: true,
              nickname: true,
            },
          },
          addressee: {
            select: {
              id: true,
              nickname: true,
            },
          },
        },
      }),
      prisma.friendship.findMany({
        where: {
          addresseeId: userId,
          status: 'pending',
        },
        include: {
          requester: {
            select: {
              id: true,
              nickname: true,
            },
          },
        },
      }),
      prisma.friendship.findMany({
        where: {
          requesterId: userId,
          status: 'pending',
        },
        include: {
          addressee: {
            select: {
              id: true,
              nickname: true,
            },
          },
        },
      }),
    ]);

    const friends = acceptedFriendships.map((friendship) => {
      const friendUser = friendship.requesterId === userId ? friendship.addressee : friendship.requester;
      return {
        id: friendUser.id,
        nickname: friendUser.nickname,
      };
    });

    const incomingRequests = incomingPending.map((friendship) => ({
      friendshipId: friendship.id,
      id: friendship.requester.id,
      nickname: friendship.requester.nickname,
    }));

    const outgoingRequests = outgoingPending.map((friendship) => ({
      friendshipId: friendship.id,
      id: friendship.addressee.id,
      nickname: friendship.addressee.nickname,
    }));

    res.status(200).json({
      ok: true,
      friends,
      incomingRequests,
      outgoingRequests,
    });
  } catch (e) {
    console.error('List friends error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
