const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const {
  refreshUserGamification,
  summarizeRounds,
} = require('../../lib/playerGamification');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { tournamentId } = req.body || {};

    if (!tournamentId) {
      return res.status(400).json({ error: 'tournamentId is required' });
    }

    // 1. Fetch tournament details with participants and check existence
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status === 'finished') {
      return res.status(400).json({ error: 'Tournament has already been finalized' });
    }

    // 2. Perform safe, atomic database transaction to prevent race conditions / double rewards
    const result = await prisma.$transaction(async (tx) => {
      // A. Update tournament status to finished
      const updatedTournament = await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'finished' },
      });

      const userUpdatesSummary = [];
      const processedUserIds = new Set();

      const rankedParticipants = [...tournament.participants].sort((a, b) => {
        if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;

        const roundsA = summarizeRounds(a.roundsReport);
        const roundsB = summarizeRounds(b.roundsReport);

        if (roundsB.wins !== roundsA.wins) return roundsB.wins - roundsA.wins;
        if (roundsA.losses !== roundsB.losses) return roundsA.losses - roundsB.losses;

        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      for (let index = 0; index < rankedParticipants.length; index++) {
        await tx.tournamentParticipant.update({
          where: { id: rankedParticipants[index].id },
          data: { finalPosition: index + 1 },
        });
      }

      // B. Process each participant's XP points
      for (const p of tournament.participants) {
        if (p.pointsProcessed) {
          console.log(`⚠️ Participant ${p.id} already processed. Skipping.`);
          continue;
        }

        // Base reward for playing: 100 XP
        let xpEarned = 100;

        // Win rewards: +50 XP per win (parsing rounds report string arrays like ["2-1", "1-2"])
        if (Array.isArray(p.roundsReport)) {
          for (const round of p.roundsReport) {
            const scores = round.split('-').map(Number);
            if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
              if (scores[0] > scores[1]) {
                xpEarned += 50; // +50 XP on match win
              }
            }
          }
        }

        // Fetch latest user profile within transaction to read accurate current XP
        const currentUser = await tx.user.findUnique({
          where: { id: p.userId },
        });

        if (currentUser) {
          const newXp = currentUser.xp + xpEarned;
          // Every 1000 XP increments level by 1
          const newLevel = Math.floor(newXp / 1000) + 1;

          // C. Commit profile updates
          const updatedUser = await tx.user.update({
            where: { id: p.userId },
            data: {
              xp: newXp,
              level: newLevel,
            },
          });

          userUpdatesSummary.push({
            userId: p.userId,
            userName: updatedUser.nickname || updatedUser.id,
            xpEarned,
            totalXp: updatedUser.xp,
            level: updatedUser.level,
          });
          processedUserIds.add(p.userId);
        }

        // D. Flag participant as processed to shield against double-processing
        await tx.tournamentParticipant.update({
          where: { id: p.id },
          data: { pointsProcessed: true },
        });
      }

      for (const processedUserId of processedUserIds) {
        const refreshed = await refreshUserGamification(tx, processedUserId);
        if (!refreshed) continue;

        const summary = userUpdatesSummary.find(
          (item) => item.userId === processedUserId,
        );
        if (summary) {
          summary.badgesUnlocked = refreshed.snapshot.badges.length;
          summary.currentRank = refreshed.snapshot.stats.currentRank;
        }
      }

      return {
        tournament: updatedTournament,
        userUpdates: userUpdatesSummary,
      };
    });

    res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error('❌ /api/tournaments/finalize error:', e);
    res.status(500).json({ error: 'Failed to finalize tournament and process XP' });
  }
};
