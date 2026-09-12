const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { inviteId, userId, action } = req.body || {};

    if (!inviteId || !userId || !action) {
      return res.status(400).json({ error: 'inviteId, userId and action are required' });
    }

    if (action !== 'accept' && action !== 'decline') {
      return res.status(400).json({ error: 'action must be accept or decline' });
    }

    const invite = await prisma.friendNightInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        eventId: true,
        invitedUserId: true,
      },
    });

    if (!invite) {
      return res.status(404).json({ error: 'invite not found' });
    }

    if (invite.invitedUserId !== userId) {
      return res.status(403).json({ error: 'only invited user can respond' });
    }

    if (action === 'accept') {
      await prisma.$transaction(async (tx) => {
        await tx.friendNightInvite.update({
          where: { id: invite.id },
          data: { status: 'accepted' },
        });

        await tx.friendNightPlayer.upsert({
          where: {
            eventId_userId: {
              eventId: invite.eventId,
              userId,
            },
          },
          update: {},
          create: {
            eventId: invite.eventId,
            userId,
            decks: [],
            rule0: null,
          },
        });
      });
    } else {
      await prisma.friendNightInvite.update({
        where: { id: invite.id },
        data: { status: 'declined' },
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Friend Night respond invite error:', e);
    return res.status(500).json({ error: 'failed', details: e.message });
  }
};
