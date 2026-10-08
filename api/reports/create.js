const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');
const { getTournamentManageAccess } = require('../../lib/tournamentAuth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res, { roles: ['store'] });
    if (!auth) return;

    const {
      tournamentId,
      round,
      tableNumber = null,
      playerId,
      infractionType,
      reason,
      judgeId,
      privateNotes = null,
    } = req.body || {};

    if (!tournamentId || round === undefined || !playerId || !infractionType || !reason || !judgeId) {
      return res.status(400).json({ error: 'Missing required judge infraction report fields' });
    }

    if (judgeId !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const access = await getTournamentManageAccess(prisma, tournamentId, auth.userId);
    if (!access.ok) {
      return res.status(access.reason === 'not_found' ? 404 : 403).json({ error: access.reason === 'not_found' ? 'Tournament not found' : 'forbidden' });
    }

    // 1. Defensively check tournament, player, and judge exist
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const player = await prisma.user.findUnique({
      where: { id: playerId },
    });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const judge = await prisma.user.findUnique({
      where: { id: judgeId },
    });
    if (!judge) {
      return res.status(404).json({ error: 'Judge user not found' });
    }

    // 2. Create the Judge Report record
    const report = await prisma.judgeReport.create({
      data: {
        tournamentId,
        round: parseInt(round, 10),
        tableNumber: tableNumber ? parseInt(tableNumber, 10) : null,
        playerId,
        infractionType,
        reason,
        judgeId,
        privateNotes,
      },
    });

    res.status(200).json({ ok: true, report });
  } catch (e) {
    console.error('❌ /api/reports/create error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

