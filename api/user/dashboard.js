const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const {
  refreshUserGamification,
  summarizeRounds,
} = require('../../lib/playerGamification');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId } = req.query || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // 1. Refrescar snapshot persistido y cargar el usuario con su histÃ³rico.
    const refreshed = await refreshUserGamification(prisma, userId);
    const user = refreshed && refreshed.user;

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

    const historicoTorneos = user.tournamentParticipants
      .filter((p) => p.tournament.status === 'finished')
      .map((p) => {
        tournamentsPlayed++;
        
        const results = [];

        if (Array.isArray(p.roundsReport)) {
          for (const round of p.roundsReport) {
            const scores = String(round).split('-').map(Number);
            if (
              scores.length === 2 &&
              !isNaN(scores[0]) &&
              !isNaN(scores[1])
            ) {
              totalMatches++;
              if (scores[0] > scores[1]) {
                matchWins++;
                results.push('W');
              } else if (scores[0] < scores[1]) {
                matchLosses++;
                results.push('L');
              } else {
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

    const storedStats = user.statsJson || {};
    const stats = {
      torneos_jugados: storedStats.tournamentsPlayed ?? tournamentsPlayed,
      win_rate_general: storedStats.winRateGeneral ?? winRateGeneral,
      comandante_favorito:
        storedStats.favoriteCommander ?? favoriteCommander,
      victorias_totales: storedStats.totalMatchWins ?? matchWins,
      partidas_totales: storedStats.totalMatches ?? totalMatches,
      top1: storedStats.top1Finishes ?? 0,
      racha_trade: storedStats.maxOpenToTradeStreak ?? 0,
      insignias_desbloqueadas:
        storedStats.badgesUnlocked ??
        (Array.isArray(user.badgesJson) ? user.badgesJson.length : 0),
    };

    res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        nickname: user.nickname,
        role: user.role,
        xp: user.xp,
        level: user.level,
        storeName: user.storeName,
        storeAddress: user.storeAddress,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      historico_torneos: historicoTorneos,
      estadisticas_globales: stats,
      badges: Array.isArray(user.badgesJson) ? user.badgesJson : [],
    });
  } catch (e) {
    console.error('âŒ /api/user/dashboard error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

