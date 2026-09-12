const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { eventId, userId } = req.body || {};

    if (!eventId || !userId) {
      return res.status(400).json({ error: 'eventId and userId are required' });
    }

    const event = await prisma.friendNightEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        startsAt: true,
        createdByUserId: true,
      },
    });

    // 404 intencional por privacidad: conocer el id exacto habilita el join.
    if (!event) {
      return res.status(404).json({ error: 'event not found' });
    }

    await prisma.friendNightPlayer.upsert({
      where: {
        eventId_userId: {
          eventId,
          userId,
        },
      },
      update: {},
      create: {
        eventId,
        userId,
        decks: [],
        rule0: null,
      },
    });

    return res.status(200).json({
      ok: true,
      event,
    });
  } catch (e) {
    console.error('Friend Night join error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
