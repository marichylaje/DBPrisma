const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId } = req.query || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // 1. Fetch user and their tournament participations
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        participants: {
          include: {
            tournament: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2. Process historical participations and compute stats dynamically
    let tournamentsPlayed = 0;
    let matchWins = 0;
    let matchLosses = 0;
    let matchDraws = 0;
    let totalMatches = 0;
    const commanderCounts = {};

    const historicoTorneos = user.participants
      .filter((p) => p.tournament.status === 'finished')
      .map((p) => {
        tournamentsPlayed++;
        
        let wins = 0;
        let losses = 0;
        let draws = 0;
        const results = [];

        if (Array.isArray(p.roundsReport)) {
          for (const round of p.roundsReport) {
            const scores = round.split('-').map(Number);
            if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
              totalMatches++;
              if (scores[0] > scores[1]) {
                wins++;
                matchWins++;
                results.push('W');
              } else if (scores[0] < scores[1]) {
                losses++;
                matchLosses++;
                results.push('L');
              } else {
                draws++;
                matchDraws++;
                results.push('D');
              }
            }
          }
        }

        const commanderUsed = p.deckSnapshot && p.deckSnapshot.commander
          ? p.deckSnapshot.commander.name
          : 'Unknown Commander';

        if (commanderUsed && commanderUsed !== 'Unknown Commander') {
          commanderCounts[commanderUsed] = (commanderCounts[commanderUsed] || 0) + 1;
        }

        return {
          id_torneo: p.tournamentId,
          nombre_evento: p.tournament.title,
          fecha: p.tournament.startDate.toISOString().split('T')[0],
          comandante_usado: commanderUsed,
          posicion: p.finalPosition,
          total_jugadores: p.tournament.maxPlayers, // o count real
          resultado_rondas: results,
        };
      });

    // 3. Find favorite commander
    let favoriteCommander = 'None';
    let maxCommanderCount = 0;
    for (const [cmd, count] of Object.entries(commanderCounts)) {
      if (count > maxCommanderCount) {
        maxCommanderCount = count;
        favoriteCommander = cmd;
      }
    }

    // 4. Compute general win-rate
    const winRateGeneral = totalMatches > 0
      ? parseFloat((((matchWins + 0.5 * matchDraws) / totalMatches) * 100).toFixed(1))
      : 0.0;

    const stats = {
      torneos_jugados: tournamentsPlayed,
      win_rate_general: winRateGeneral,
      comandante_favorito: favoriteCommander,
    };

    res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        surname: user.surname,
        username: user.username,
        avatarUrl: user.avatarUrl,
        xp: user.xp,
        level: user.level,
      },
      historico_torneos: historicoTorneos,
      estadisticas_globales: stats,
    });
  } catch (e) {
    console.error('❌ /api/user/dashboard error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
