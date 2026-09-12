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

    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const invites = await prisma.friendNightInvite.findMany({
      where: {
        invitedUserId: userId.trim(),
        status: 'pending',
      },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            startsAt: true,
          },
        },
        invitedBy: {
          select: {
            nickname: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json({
      ok: true,
      invites: invites.map((invite) => ({
        id: invite.id,
        event: {
          id: invite.event.id,
          name: invite.event.name,
          startsAt: invite.event.startsAt,
        },
        invitedByNickname: invite.invitedBy?.nickname || null,
      })),
    });
  } catch (e) {
    console.error('Friend Night invites error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
