const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'PUT') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { eventId, userId, decks, rule0 } = req.body || {};

    if (typeof eventId !== 'string' || !eventId.trim() || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'eventId and userId are required' });
    }

    const normalizedEventId = eventId.trim();
    const normalizedUserId = userId.trim();

    const existingPlayer = await prisma.friendNightPlayer.findUnique({
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

    if (!existingPlayer) {
      return res.status(403).json({ error: 'not a participant' });
    }

    const updateData = {};

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'decks')) {
      if (!Array.isArray(decks)) {
        return res.status(400).json({ error: 'decks must be an array' });
      }
      updateData.decks = decks;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'rule0')) {
      if (typeof rule0 !== 'string') {
        return res.status(400).json({ error: 'rule0 must be a string' });
      }
      updateData.rule0 = rule0;
    }

    const updatedPlayer = Object.keys(updateData).length > 0
      ? await prisma.friendNightPlayer.update({
        where: {
          eventId_userId: {
            eventId: normalizedEventId,
            userId: normalizedUserId,
          },
        },
        data: updateData,
        select: {
          id: true,
          decks: true,
          rule0: true,
        },
      })
      : await prisma.friendNightPlayer.findUnique({
        where: {
          eventId_userId: {
            eventId: normalizedEventId,
            userId: normalizedUserId,
          },
        },
        select: {
          id: true,
          decks: true,
          rule0: true,
        },
      });

    return res.status(200).json({
      ok: true,
      player: updatedPlayer,
    });
  } catch (e) {
    if (e && e.code === 'P2025') {
      return res.status(404).json({ error: 'player not found' });
    }

    console.error('Friend Night update player error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};