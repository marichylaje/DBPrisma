const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

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
    console.error('âŒ /api/user/get error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};

