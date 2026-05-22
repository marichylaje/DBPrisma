const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { tournamentId, userId } = req.query || {};

    if (!tournamentId || !userId) {
      return res.status(400).json({ error: 'tournamentId and userId are required' });
    }

    // 1. Fetch tournament details
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status === 'created') {
      return res.status(200).json({ ok: true, active: false, message: 'Tournament has not started yet' });
    }

    const round = tournament.currentRound;

    // 2. Fetch all matches for the current round
    const matches = await prisma.tournamentMatch.findMany({
      where: {
        tournamentId,
        round,
      },
    });

    // 3. Find the match that contains the active player
    const userMatch = matches.find((m) => {
      const playersList = Array.isArray(m.players) ? m.players : [];
      return playersList.some((p) => p.userId === userId);
    });

    if (!userMatch) {
      return res.status(200).json({
        ok: true,
        active: false,
        message: 'No match found for you in the current round (you might have a BYE)',
      });
    }

    const playersList = Array.isArray(userMatch.players) ? userMatch.players : [];
    const opponents = playersList.filter((p) => p.userId !== userId);

    res.status(200).json({
      ok: true,
      active: true,
      round,
      tableNumber: userMatch.tableNumber,
      matchId: userMatch.id,
      opponents,
      status: userMatch.status,
      results: userMatch.results,
    });
  } catch (e) {
    console.error('❌ /api/tournaments/active-match error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
