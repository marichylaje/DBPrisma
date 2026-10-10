const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireUser } = require('../../lib/auth');
const { getQueryParam } = require('../../lib/requestQuery');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireUser(req, res);
    if (!auth) return;

    const userId = getQueryParam(req, 'userId');

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        role: true,
        xp: true,
        level: true,
        storeName: true,
        storeAddress: true,
        createdAt: true,
        updatedAt: true,
        badgesJson: true,
        statsJson: true,
      },
    });

    res.status(200).json({
      ok: true,
      user: user || null,
    });
  } catch (e) {
    console.error('❌ /api/user/get error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

