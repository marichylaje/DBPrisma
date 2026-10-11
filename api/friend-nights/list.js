const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    const { userId } = req.query || {};

    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (userId.trim() !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const memberships = await prisma.friendNightPlayer.findMany({
      where: {
        userId: userId.trim(),
      },
      include: {
        event: {
          include: {
            players: {
              include: {
                user: {
                  select: {
                    id: true,
                    nickname: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        event: {
          startsAt: 'asc',
        },
      },
    });

    const events = memberships.map((membership) => ({
      id: membership.event.id,
      name: membership.event.name,
      startsAt: membership.event.startsAt,
      createdByUserId: membership.event.createdByUserId,
      players: membership.event.players.map((player) => ({
        id: player.userId,
        name: player.user?.nickname || null,
        decks: player.decks,
        rule0: player.rule0,
        isMe: player.userId === auth.userId,
      })),
    }));

    return res.status(200).json({
      ok: true,
      events,
    });
  } catch (e) {
    console.error('Friend Night list error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
