const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { tournamentId } = req.body || {};

    if (!tournamentId) {
      return res.status(400).json({ error: 'tournamentId is required' });
    }

    // 1. Fetch tournament and participants
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          include: {
            user: true,
          },
        },
        matches: true,
      },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status === 'finished') {
      return res.status(400).json({ error: 'Tournament has already finished' });
    }

    const currentRound = tournament.currentRound;
    const participants = tournament.participants.filter(p => !p.isDropped);

    if (participants.length < 2) {
      return res.status(400).json({ error: 'At least 2 active participants are required to generate rounds' });
    }

    // 2. If tournament is active, verify all matches from the previous round are reported
    if (currentRound > 0) {
      const pendingMatches = tournament.matches.filter(
        (m) => m.round === currentRound && m.status !== 'reported'
      );
      if (pendingMatches.length > 0) {
        return res.status(400).json({
          error: `Cannot generate the next round. Round ${currentRound} has ${pendingMatches.length} pending match reports.`,
        });
      }
    }

    const nextRound = currentRound + 1;
    const isMultiplayer = tournament.format === 'commander_multiplayer';

    // 3. Build past opponents history map for Swiss matching
    const opponentHistory = {};
    const byeHistory = new Set();

    for (const p of participants) {
      opponentHistory[p.userId] = new Set();
    }

    for (const m of tournament.matches) {
      const playersList = Array.isArray(m.players) ? m.players : [];
      if (playersList.length === 1) {
        // This was a BYE
        byeHistory.add(playersList[0].userId);
      } else {
        for (const pA of playersList) {
          for (const pB of playersList) {
            if (pA.userId !== pB.userId && opponentHistory[pA.userId]) {
              opponentHistory[pA.userId].add(pB.userId);
            }
          }
        }
      }
    }

    // 4. Sort players for Swiss pairing
    // Sort criteria: Match Points descending, then random/registration order
    const sortedPlayers = [...participants].sort((a, b) => {
      if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const tables = [];
    let tableCounter = 1;

    // --- SWISS PAIRING ENGINE ---

    if (isMultiplayer) {
      // Commander Multiplayer: Tables of 4 players (or 3 if remainder)
      const unassigned = [...sortedPlayers];

      while (unassigned.length > 0) {
        let tableSize = 4;
        // If remaining players is 5 or 6, we split them into tables of 3 to avoid a single table of 1 or 2 players
        if (unassigned.length === 5) {
          tableSize = 3;
        } else if (unassigned.length === 6) {
          tableSize = 3;
        } else if (unassigned.length < 3) {
          tableSize = unassigned.length;
        }

        const tablePlayers = [];
        // First player is the highest ranked unassigned
        const leadPlayer = unassigned.shift();
        tablePlayers.push(leadPlayer);

        // Find matches for this table
        for (let i = 1; i < tableSize && unassigned.length > 0; i++) {
          // Look for next unassigned player that has not played against the leadPlayer
          let foundIdx = -1;
          for (let j = 0; j < unassigned.length; j++) {
            const candidate = unassigned[j];
            const hasPlayed = tablePlayers.some((tp) =>
              opponentHistory[tp.userId].has(candidate.userId)
            );
            if (!hasPlayed) {
              foundIdx = j;
              break;
            }
          }

          // Fallback if everyone has played each other: just take the next highest ranked
          if (foundIdx === -1) {
            foundIdx = 0;
          }

          const matched = unassigned.splice(foundIdx, 1)[0];
          tablePlayers.push(matched);
        }

        tables.push({
          tableNumber: tableCounter++,
          players: tablePlayers.map((p) => ({
            userId: p.userId,
            name: p.user.nickname || p.user.id,
          })),
        });
      }
    } else {
      // Duel 1vs1: Tables of 2 players
      const unassigned = [...sortedPlayers];

      // Handle BYE if number of players is odd
      if (unassigned.length % 2 !== 0) {
        // Select the lowest ranked player who has not received a BYE yet
        let byeIdx = unassigned.length - 1;
        for (let i = unassigned.length - 1; i >= 0; i--) {
          if (!byeHistory.has(unassigned[i].userId)) {
            byeIdx = i;
            break;
          }
        }

        const byePlayer = unassigned.splice(byeIdx, 1)[0];
        tables.push({
          tableNumber: tableCounter++,
          players: [{
            userId: byePlayer.userId,
            name: byePlayer.user.nickname || byePlayer.user.id,
          }],
          isBye: true,
        });
      }

      // Pair the remaining players
      while (unassigned.length > 0) {
        const pA = unassigned.shift();
        let matchedIdx = -1;

        // Try to match with the closest rank who has not been an opponent
        for (let j = 0; j < unassigned.length; j++) {
          const candidate = unassigned[j];
          if (!opponentHistory[pA.userId].has(candidate.userId)) {
            matchedIdx = j;
            break;
          }
        }

        // Fallback: take next highest rank
        if (matchedIdx === -1) {
          matchedIdx = 0;
        }

        const pB = unassigned.splice(matchedIdx, 1)[0];
        tables.push({
          tableNumber: tableCounter++,
          players: [
            { userId: pA.userId, name: pA.user.nickname || pA.user.id },
            { userId: pB.userId, name: pB.user.nickname || pB.user.id },
          ],
        });
      }
    }

    // 5. Commit round generation to the database in a transaction
    const createdMatches = await prisma.$transaction(async (tx) => {
      // A. Update tournament state
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          currentRound: nextRound,
          status: 'active', // Advance to active status
        },
      });

      const matchesCreated = [];

      // B. Create matches in database
      for (const t of tables) {
        let results = null;
        let status = 'pending';
        let reportedBy = null;

        if (t.isBye) {
          // Auto-report BYE match immediately
          const playerObj = t.players[0];
          results = {
            winnerId: playerObj.userId,
            score: '2-0',
            reportedBy: 'SYSTEM_BYE',
            reportedAt: Date.now(),
          };
          status = 'reported';
          reportedBy = 'SYSTEM_BYE';

          // Add points to participant record
          const pRecord = participants.find((p) => p.userId === playerObj.userId);
          if (pRecord) {
            const currentReports = Array.isArray(pRecord.roundsReport)
              ? [...pRecord.roundsReport]
              : [];
            
            const roundIdx = nextRound - 1;
            while (currentReports.length < roundIdx) {
              currentReports.push('0-0');
            }
            currentReports.push('2-0');

            let newMatchPoints = 0;
            for (const rep of currentReports) {
              const sc = rep.split('-').map(Number);
              if (sc.length === 2) {
                if (sc[0] > sc[1]) newMatchPoints += 3;
                else if (sc[0] === sc[1]) newMatchPoints += 1;
              }
            }

            await tx.tournamentParticipant.update({
              where: { id: pRecord.id },
              data: {
                roundsReport: currentReports,
                matchPoints: newMatchPoints,
              },
            });
          }
        }

        const match = await tx.tournamentMatch.create({
          data: {
            tournamentId,
            round: nextRound,
            tableNumber: t.tableNumber,
            players: t.players,
            status,
            results,
            reportedBy,
          },
        });

        matchesCreated.push(match);
      }

      return matchesCreated;
    });

    res.status(200).json({ ok: true, round: nextRound, matches: createdMatches });
  } catch (e) {
    console.error('âŒ /api/tournaments/generate-round error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

