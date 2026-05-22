const BADGE_DEFINITIONS = [
  {
    id: 'first_tournament',
    name: '🎟️ Primer Sello',
    description: 'Completar 1 torneo oficialmente finalizado.',
    isUnlocked: (stats) => stats.tournamentsPlayed >= 1,
  },
  {
    id: 'seasoned_traveler',
    name: '🌍 Caminante Habitual',
    description: 'Completar 5 torneos oficialmente finalizados.',
    isUnlocked: (stats) => stats.tournamentsPlayed >= 5,
  },
  {
    id: 'immortal',
    name: '🥇 Inmortal',
    description: 'Terminar un torneo de 4 o más rondas sin registrar derrotas.',
    isUnlocked: (stats) => stats.undefeatedRuns >= 1,
  },
  {
    id: 'archmage',
    name: '🧙‍♂️ Mago Supremo',
    description: 'Alcanzar el nivel 10 de Planeswalker.',
    isUnlocked: (stats, user) => (user.level ?? 1) >= 10,
  },
  {
    id: 'table_champion',
    name: '👑 Campeón de Mesa',
    description: 'Finalizar al menos 1 torneo en primera posición.',
    isUnlocked: (stats) => stats.top1Finishes >= 1,
  },
  {
    id: 'solid_strategist',
    name: '📈 Estratega Sólido',
    description:
      'Mantener al menos un 60% de win rate tras disputar 10 o más partidas.',
    isUnlocked: (stats) =>
      stats.totalMatches >= 10 && stats.winRateGeneral >= 60,
  },
  {
    id: 'negotiator',
    name: '🤝 Negociador',
    description: 'Marcar openToTrade en 5 torneos finalizados consecutivos.',
    isUnlocked: (stats) => stats.maxOpenToTradeStreak >= 5,
  },
  {
    id: 'loyal_commander',
    name: '⚔️ Comandante Leal',
    description: 'Usar el mismo comandante principal en 3 torneos finalizados.',
    isUnlocked: (stats) => stats.favoriteCommanderCount >= 3,
  },
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getRankFromXp(xp) {
  if (xp >= 8000) {
    return { rank: 'Dragón Anciano', nextLevelXp: 15000 };
  }
  if (xp >= 3000) {
    return { rank: 'Planeswalker', nextLevelXp: 8000 };
  }
  if (xp >= 1000) {
    return { rank: 'Mago de Gremio', nextLevelXp: 3000 };
  }
  return { rank: 'Aprendiz', nextLevelXp: 1000 };
}

function summarizeRounds(roundsReport) {
  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (const round of safeArray(roundsReport)) {
    const scores = String(round)
      .split('-')
      .map((value) => Number(value));

    if (
      scores.length !== 2 ||
      Number.isNaN(scores[0]) ||
      Number.isNaN(scores[1])
    ) {
      continue;
    }

    if (scores[0] > scores[1]) {
      wins++;
    } else if (scores[0] < scores[1]) {
      losses++;
    } else {
      draws++;
    }
  }

  return {
    wins,
    losses,
    draws,
    roundsPlayed: wins + losses + draws,
  };
}

function getCommanderName(deckSnapshot) {
  const commanderName = normalizeText(
    deckSnapshot && deckSnapshot.commander && deckSnapshot.commander.name,
  );
  return commanderName || 'Unknown Commander';
}

function buildFinishedEntries(user) {
  return safeArray(user.participants)
    .filter(
      (participant) =>
        participant &&
        participant.tournament &&
        participant.tournament.status === 'finished',
    )
    .map((participant) => {
      const roundSummary = summarizeRounds(participant.roundsReport);
      return {
        ...participant,
        ...roundSummary,
        commanderName: getCommanderName(participant.deckSnapshot),
      };
    })
    .sort((a, b) => {
      const dateDiff =
        new Date(a.tournament.startDate).getTime() -
        new Date(b.tournament.startDate).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function buildStats(user) {
  const finishedEntries = buildFinishedEntries(user);
  const commanderCounts = {};
  const uniqueLocations = new Set();

  let totalMatchWins = 0;
  let totalMatchLosses = 0;
  let totalMatchDraws = 0;
  let top1Finishes = 0;
  let undefeatedRuns = 0;
  let maxOpenToTradeStreak = 0;
  let currentOpenToTradeStreak = 0;

  for (const entry of finishedEntries) {
    totalMatchWins += entry.wins;
    totalMatchLosses += entry.losses;
    totalMatchDraws += entry.draws;

    if (entry.finalPosition === 1) {
      top1Finishes++;
    }

    if (entry.roundsPlayed >= 4 && entry.losses === 0) {
      undefeatedRuns++;
    }

    if (entry.openToTrade) {
      currentOpenToTradeStreak++;
      if (currentOpenToTradeStreak > maxOpenToTradeStreak) {
        maxOpenToTradeStreak = currentOpenToTradeStreak;
      }
    } else {
      currentOpenToTradeStreak = 0;
    }

    if (entry.commanderName !== 'Unknown Commander') {
      commanderCounts[entry.commanderName] =
        (commanderCounts[entry.commanderName] || 0) + 1;
    }

    const locationName = normalizeText(entry.tournament.locationName);
    if (locationName) {
      uniqueLocations.add(locationName);
    }
  }

  let favoriteCommander = 'None';
  let favoriteCommanderCount = 0;
  for (const [commanderName, count] of Object.entries(commanderCounts)) {
    if (count > favoriteCommanderCount) {
      favoriteCommander = commanderName;
      favoriteCommanderCount = count;
    }
  }

  const totalMatches = totalMatchWins + totalMatchLosses + totalMatchDraws;
  const winRateGeneral =
    totalMatches > 0
      ? parseFloat(
          (
            ((totalMatchWins + 0.5 * totalMatchDraws) / totalMatches) *
            100
          ).toFixed(1),
        )
      : 0;

  const xp = user.xp ?? 0;
  const rankInfo = getRankFromXp(xp);

  return {
    tournamentsPlayed: finishedEntries.length,
    totalMatches,
    totalMatchWins,
    totalMatchLosses,
    totalMatchDraws,
    winRateGeneral,
    top1Finishes,
    undefeatedRuns,
    maxOpenToTradeStreak,
    favoriteCommander,
    favoriteCommanderCount,
    distinctLocations: uniqueLocations.size,
    currentRank: rankInfo.rank,
    nextLevelXp: rankInfo.nextLevelXp,
  };
}

function buildUnlockedBadges(user, stats) {
  const existingBadges = new Map(
    safeArray(user.badgesJson).map((badge) => [badge.id, badge]),
  );
  const awardedAtFallback = new Date().toISOString();

  return BADGE_DEFINITIONS.filter((badge) => badge.isUnlocked(stats, user)).map(
    (badge) => {
      const previous = existingBadges.get(badge.id);
      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        awardedAt:
          previous && previous.awardedAt
            ? previous.awardedAt
            : awardedAtFallback,
      };
    },
  );
}

function buildGamificationSnapshot(user) {
  const stats = buildStats(user);
  const badges = buildUnlockedBadges(user, stats);

  return {
    stats: {
      ...stats,
      badgesUnlocked: badges.length,
    },
    badges,
  };
}

async function refreshUserGamification(db, userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      participants: {
        include: {
          tournament: true,
        },
      },
    },
  });

  if (!user || user.role !== 'player') {
    return null;
  }

  const snapshot = buildGamificationSnapshot(user);

  await db.user.update({
    where: { id: userId },
    data: {
      statsJson: snapshot.stats,
      badgesJson: snapshot.badges,
    },
  });

  return {
    user: {
      ...user,
      statsJson: snapshot.stats,
      badgesJson: snapshot.badges,
    },
    snapshot,
  };
}

module.exports = {
  BADGE_DEFINITIONS,
  buildGamificationSnapshot,
  refreshUserGamification,
  summarizeRounds,
};
