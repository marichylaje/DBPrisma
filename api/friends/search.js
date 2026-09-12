const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'GET') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { userId, query } = req.query || {};

    if (typeof userId !== 'string' || !userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'query is required (min 2 characters)' });
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        nickname: {
          contains: query.trim(),
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        nickname: true,
      },
      take: 10,
    });

    res.status(200).json({
      ok: true,
      users,
    });
  } catch (e) {
    console.error('Search friends error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
