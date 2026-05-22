const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId, name, surname = '', email = '' } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const defaultEmail = email || `${userId}@planeswalker.com`;

    const upserted = await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name: name,
        surname: surname,
        email: defaultEmail,
        role: 'player',
        xp: 0,
        level: 1,
        statsJson: {
          tournamentsPlayed: 0,
          totalMatches: 0,
          totalMatchWins: 0,
          totalMatchLosses: 0,
          totalMatchDraws: 0,
          winRateGeneral: 0,
          top1Finishes: 0,
          undefeatedRuns: 0,
          maxOpenToTradeStreak: 0,
          favoriteCommander: 'None',
          favoriteCommanderCount: 0,
          distinctLocations: 0,
          currentRank: 'Aprendiz',
          nextLevelXp: 1000,
          badgesUnlocked: 0,
        },
        badgesJson: [],
      },
      update: {
        name: name,
        surname: surname,
        email: defaultEmail,
      },
    });

    res.status(200).json({ ok: true, user: upserted });
  } catch (e) {
    console.error('❌ /api/user/save error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
