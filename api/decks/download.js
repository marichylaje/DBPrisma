const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { deckType, deckId, deckKey } = req.body || {};

    if (!deckType || !['cloud', 'precon', 'influencer'].includes(deckType)) {
      return res.status(400).json({ error: 'deckType must be cloud, precon or influencer' });
    }

    if (deckType === 'cloud') {
      if (!deckId) {
        return res.status(400).json({ error: 'deckId is required for cloud decks' });
      }

      const deck = await prisma.userDeck.update({
        where: { id: deckId },
        data: { downloadCount: { increment: 1 } },
        select: { downloadCount: true },
      });

      return res.status(200).json({ success: true, count: Number(deck.downloadCount ?? 0) });
    }

    const normalizedDeckKey = typeof deckKey === 'string' ? deckKey.trim() : '';
    if (!normalizedDeckKey) {
      return res.status(400).json({ error: 'deckKey is required' });
    }

    const saved = await prisma.deckDownload.upsert({
      where: { deckKey: normalizedDeckKey },
      update: { count: { increment: 1 } },
      create: { deckKey: normalizedDeckKey, count: 1 },
      select: { count: true },
    });

    return res.status(200).json({ success: true, count: Number(saved.count ?? 0) });
  } catch (e) {
    console.error('❌ /api/decks/download', e);
    res.status(500).json({ error: 'failed' });
  }
};
