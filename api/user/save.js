const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const {
      userId,
      nickname,
      role,
      storeAddress = null,
      storeName = null,
    } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!nickname) {
      return res.status(400).json({ error: 'nickname is required' });
    }

    const upserted = await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        nickname: nickname,
        role: role || 'player',
        xp: 0,
        level: 1,
        storeName: role === 'store' ? storeName : null,
        storeAddress: role === 'store' ? storeAddress : null,
      },
      update: {
        nickname: nickname,
        ...(role ? { role } : {}),
        ...(role === 'store'
          ? { storeName, storeAddress }
          : {}),
      },
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
      },
    });

    res.status(200).json({ ok: true, user: upserted });
  } catch (e) {
    console.error('❌ /api/user/save error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
