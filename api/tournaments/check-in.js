const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');
const { getTournamentManageAccess } = require('../../lib/tournamentAuth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'PUT') return res.status(405).end();

    const auth = requireUser(req, res, { roles: ['store'] });
    if (!auth) return;

    const {
      tournamentId,
      userId,
      paymentStatus,
      paymentMethod = 'Cash',
      decklistValidated,
    } = req.body || {};

    if (!tournamentId || !userId) {
      return res.status(400).json({ error: 'tournamentId and userId are required' });
    }

    const access = await getTournamentManageAccess(prisma, tournamentId, auth.userId);
    if (!access.ok) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({ error: access.reason === 'not_found' ? 'Tournament not found' : 'forbidden' });
    }

    // 1. Fetch participant record
    const participant = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId,
          userId,
        },
      },
    });

    if (!participant) {
      return res.status(404).json({ error: 'Participant enrollment not found' });
    }

    // 2. Perform updates
    const updateData = {};
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (paymentMethod) updateData.paymentMethod = paymentMethod;
    if (decklistValidated !== undefined) updateData.decklistValidated = !!decklistValidated;

    const updated = await prisma.tournamentParticipant.update({
      where: { id: participant.id },
      data: updateData,
    });

    res.status(200).json({ ok: true, participant: updated });
  } catch (e) {
    console.error('❌ /api/tournaments/check-in error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

