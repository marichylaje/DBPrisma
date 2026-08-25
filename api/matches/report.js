const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { matchId, winnerId, score = '2-0', reportedBy } = req.body || {};

    if (!matchId || !winnerId || !reportedBy) {
      return res.status(400).json({ error: 'matchId, winnerId, and reportedBy are required' });
    }

    // 1. Fetch match details
    const match = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      include: {
        tournament: true,
      },
    });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const playersList = Array.isArray(match.players) ? match.players : [];

    // Parse scores: e.g. "2-1" or "2-0"
    const scoreParts = score.split('-').map(Number);
    const highVal = Math.max(...scoreParts);
    const lowVal = Math.min(...scoreParts);

    const winnerScoreStr = `${highVal}-${lowVal}`;
    const loserScoreStr = `${lowVal}-${highVal}`;
    const drawScoreStr = `${highVal}-${highVal}`;

    const results = {
      winnerId,
      score,
      reportedBy,
      reportedAt: Date.now(),
    };

    // 2. Perform safe update in transaction
    const updatedMatch = await prisma.$transaction(async (tx) => {
      // A. Update the match results and status
      const updated = await tx.tournamentMatch.update({
        where: { id: matchId },
        data: {
          results,
          status: 'reported',
          reportedBy,
        },
      });

      // B. Update rounds report and points for each participant in this match
      for (const p of playersList) {
        const participant = await tx.tournamentParticipant.findUnique({
          where: {
            tournamentId_userId: {
              tournamentId: match.tournamentId,
              userId: p.userId,
            },
          },
        });

        if (participant) {
          let roundResultStr = drawScoreStr; // default draw
          let pointsToAdd = 1; // 1 point for draw

          if (winnerId !== 'draw') {
            if (p.userId === winnerId) {
              roundResultStr = winnerScoreStr;
              pointsToAdd = 3; // 3 points for win
            } else {
              roundResultStr = loserScoreStr;
              pointsToAdd = 0; // 0 points for loss
            }
          }

          // Append this round's result (making sure we don't duplicate if already reported)
          // We can check if length matches round, or simply replace/push
          const currentReports = Array.isArray(participant.roundsReport)
            ? [...participant.roundsReport]
            : [];

          // If this round's report was already added, we overwrite it, otherwise push it
          const roundIdx = match.round - 1;
          if (roundIdx < currentReports.length) {
            currentReports[roundIdx] = roundResultStr;
          } else {
            // Push missing intermediate rounds if any
            while (currentReports.length < roundIdx) {
              currentReports.push('0-0');
            }
            currentReports.push(roundResultStr);
          }

          // Recalculate match points
          let newMatchPoints = 0;
          for (const rep of currentReports) {
            const sc = rep.split('-').map(Number);
            if (sc.length === 2) {
              if (sc[0] > sc[1]) newMatchPoints += 3;
              else if (sc[0] === sc[1]) newMatchPoints += 1;
            }
          }

          await tx.tournamentParticipant.update({
            where: { id: participant.id },
            data: {
              roundsReport: currentReports,
              matchPoints: newMatchPoints,
            },
          });
        }
      }

      return updated;
    });

    res.status(200).json({ ok: true, match: updatedMatch });
  } catch (e) {
    console.error('âŒ /api/matches/report error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

