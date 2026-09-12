const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

function generateFriendNightId() {
  let token = '';
  while (token.length < 6) {
    token += Math.random().toString(36).slice(2).toUpperCase();
  }
  return `FN-${token.slice(0, 6)}`;
}

async function findAvailableFriendNightId(maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generateFriendNightId();
    const existing = await prisma.friendNightEvent.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return id;
    }
  }

  throw new Error('Unable to generate unique Friend Night id');
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const {
      name,
      startsAt,
      createdByUserId,
      inviteFriendUserIds = [],
    } = req.body || {};

    if (!name || !startsAt || !createdByUserId) {
      return res.status(400).json({ error: 'name, startsAt and createdByUserId are required' });
    }

    if (!Array.isArray(inviteFriendUserIds)) {
      return res.status(400).json({ error: 'inviteFriendUserIds must be an array' });
    }

    const parsedStartsAt = new Date(startsAt);
    if (Number.isNaN(parsedStartsAt.getTime())) {
      return res.status(400).json({ error: 'startsAt must be a valid ISO date string' });
    }

    const eventId = await findAvailableFriendNightId(5);

    const uniqueInviteUserIds = [...new Set(
      inviteFriendUserIds
        .filter((userId) => typeof userId === 'string')
        .map((userId) => userId.trim())
        .filter((userId) => userId && userId !== createdByUserId)
    )];

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.friendNightEvent.create({
        data: {
          id: eventId,
          name,
          startsAt: parsedStartsAt,
          createdByUserId,
        },
        select: {
          id: true,
          name: true,
          startsAt: true,
        },
      });

      await tx.friendNightPlayer.create({
        data: {
          eventId: event.id,
          userId: createdByUserId,
          decks: [],
          rule0: null,
        },
      });

      let invitedCount = 0;

      if (uniqueInviteUserIds.length > 0) {
        const createdInvites = await tx.friendNightInvite.createMany({
          data: uniqueInviteUserIds.map((invitedUserId) => ({
            eventId: event.id,
            invitedUserId,
            invitedByUserId: createdByUserId,
            status: 'pending',
          })),
        });

        invitedCount = createdInvites.count;
      }

      return { event, invitedCount };
    });

    return res.status(200).json({
      ok: true,
      event: result.event,
      invitedCount: result.invitedCount,
    });
  } catch (e) {
    console.error('Friend Night create error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
