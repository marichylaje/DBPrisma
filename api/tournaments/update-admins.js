const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireUser(req, res, { roles: ['store'] });
    if (!auth) return;

    const { tournamentId, admins } = req.body || {};

    if (!tournamentId || !Array.isArray(admins)) {
      return res.status(400).json({ error: 'tournamentId and admins array are required' });
    }

    // 1. Fetch tournament
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // 2. Security Check: Only the creator (storeId) can modify co-admins
    if (tournament.storeId !== auth.userId) {
      return res.status(403).json({ error: 'Only the tournament creator can manage co-administrators' });
    }

    // 3. Update admins
    const updated = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        admins,
      },
    });

    res.status(200).json({ ok: true, tournament: updated });
  } catch (e) {
    console.error('❌ /api/tournaments/update-admins error:', e);
    res.status(500).json({ error: 'Failed to update co-administrators', details: e.message });
  }
};

