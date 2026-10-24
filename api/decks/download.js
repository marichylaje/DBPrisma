const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { parseDeckKey } = require('../../lib/deckDownloads');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    // Requiere sesión (de dispositivo o cuenta) + límite por IP para que nadie infle contadores.
    const auth = requireOwner(req, res);
    if (!auth) return;
    const rateOk = await checkRateLimitTiers(req, res, 'deck-download', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 120, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const { deckType: rawDeckType, deckId: rawDeckId, deckKey } = req.body || {};
    if (deckKey !== undefined && (typeof deckKey !== 'string' || deckKey.length > 200)) {
      return res.status(400).json({ error: 'invalid deckKey' });
    }
    const parsedKey = parseDeckKey(deckKey);

    const deckType = rawDeckType || parsedKey?.type;
    const deckId =
      rawDeckId ||
      (parsedKey?.type === 'cloud' || parsedKey?.type === 'alldeck' ? parsedKey.id : undefined);

    if (!deckType || !['cloud', 'alldeck', 'precon', 'influencer'].includes(deckType)) {
      return res.status(400).json({ error: 'deckType must be cloud, alldeck, precon or influencer' });
    }
    if (deckId !== undefined && (typeof deckId !== 'string' || deckId.length > 64)) {
      return res.status(400).json({ error: 'invalid deckId' });
    }

    try {
      if (deckType === 'alldeck') {
        if (!deckId) {
          return res.status(400).json({ error: 'deckId is required for alldeck decks' });
        }

        const deck = await prisma.allDeck.update({
          where: { id: deckId },
          data: { downloadCount: { increment: 1 } },
          select: { downloadCount: true },
        });

        return res.status(200).json({ success: true, count: Number(deck.downloadCount ?? 0) });
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
    } catch (e) {
      if (e && e.code === 'P2025') return res.status(404).json({ error: 'not_found' });
      throw e;
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
    sendServerError(res, '/api/decks/download', e);
  }
};
