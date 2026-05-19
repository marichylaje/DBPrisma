const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { tournamentId, userId, deck = null, openToTrade = false } = req.body || {};

    if (!tournamentId || !userId) {
      return res.status(400).json({ error: 'tournamentId and userId are required' });
    }

    // 1. Fetch tournament details and confirm it exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // 2. Fetch player and confirm role
    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          name: userId === 'player-1' ? 'Jared' : 'New Player',
          surname: userId === 'player-1' ? 'Carvalho' : 'User',
          email: userId === 'player-1' ? 'jared@planeswalker.com' : `${userId}@planeswalker.com`,
          role: 'player',
          xp: 0,
          level: 1,
        }
      });
    } else if (user.role !== 'player') {
      return res.status(400).json({ error: 'Only players can enroll in tournaments' });
    }

    // 3. Deep Copy / Snapshot deck if format requires it (not 'draft')
    const isDraft = tournament.format === 'draft';
    let deckSnapshot = null;

    if (!isDraft && deck) {
      // CRITICAL SECURITY REQUIREMENT: Deep copy to prevent memory references/modifications
      deckSnapshot = JSON.parse(JSON.stringify({
        name: deck.name || 'Unnamed Deck',
        commander: deck.commander ? {
          name: deck.commander.name || '',
          id: deck.commander.id || null,
          image_url: deck.commander.image_url || null,
        } : null,
        partner: deck.partner ? {
          name: deck.partner.name || '',
          id: deck.partner.id || null,
          image_url: deck.partner.image_url || null,
        } : null,
        cards: Array.isArray(deck.cards) ? deck.cards.map(c => ({
          name: c.name,
          count: c.count || 1,
          id: c.id || null,
          image_url: c.image_url || null,
        })) : [],
      }));
    }

    // 4. Register the player into the tournament participant list
    const participant = await prisma.tournamentParticipant.create({
      data: {
        tournamentId,
        userId,
        deckSnapshot,
        openToTrade: !!openToTrade,
        roundsReport: [],
        pointsProcessed: false,
      },
    });

    res.status(200).json({ ok: true, participant });
  } catch (e) {
    console.error('❌ /api/tournaments/enroll error:', e);
    // Control compound unique constraint violations (already registered)
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Player is already registered in this tournament' });
    }
    res.status(500).json({ error: 'Failed to enroll in tournament' });
  }
};
