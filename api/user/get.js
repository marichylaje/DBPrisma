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

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
