const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { eventId, userId } = req.query || {};

    if (typeof eventId !== 'string' || !eventId.trim() || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'eventId and userId are required' });
    }

    const normalizedEventId = eventId.trim();
    const normalizedUserId = userId.trim();

    const participant = await prisma.friendNightPlayer.findUnique({
      where: {
        eventId_userId: {
          eventId: normalizedEventId,
          userId: normalizedUserId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!participant) {
      return res.status(403).json({ error: 'not a participant' });
    }

    const event = await prisma.friendNightEvent.findUnique({
      where: {
        id: normalizedEventId,
      },
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
    });

    if (!event) {
      return res.status(404).json({ error: 'event not found' });
    }

    return res.status(200).json({
      ok: true,
      event: {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt,
        createdByUserId: event.createdByUserId,
        players: event.players.map((player) => ({
          id: player.user?.id || player.userId,
          name: player.user?.nickname || null,
          decks: player.decks,
          rule0: player.rule0,
        })),
      },
    });
  } catch (e) {
    console.error('Friend Night get error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};