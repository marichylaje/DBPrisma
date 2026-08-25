const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');
const { parseDeckKey } = require('../../lib/deckDownloads');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const { deckType: rawDeckType, deckId: rawDeckId, deckKey } = req.body || {};
    const parsedKey = parseDeckKey(deckKey);

    const deckType = rawDeckType || parsedKey?.type;
    const deckId = rawDeckId || (parsedKey?.type === 'cloud' ? parsedKey.id : undefined);

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

    const normalizedDeckKey =
      typeof deckKey === 'string' ? deckKey.trim() : parsedKey?.deckKey ?? '';
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
    console.error('âŒ /api/decks/download', e);
    res.status(500).json({ error: 'failed' });
  }
};

