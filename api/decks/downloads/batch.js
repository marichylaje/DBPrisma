const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../../lib/prisma');
const { parseDeckKey } = require('../../../lib/deckDownloads');
const { checkRateLimitTiers } = require('../../../lib/rateLimit');
const { sendServerError } = require('../../../lib/httpError');

const MAX_KEYS = 200;

// Lectura pública de contadores (no expone datos de usuario); limitada en tamaño y por IP.
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const rateOk = await checkRateLimitTiers(req, res, 'downloads-batch', [
      { id: 'burst', limit: 10, windowSeconds: 10 },
      { id: 'sustained', limit: 300, windowSeconds: 3600 },
    ]);
    if (!rateOk) return;

    const rawKeys = Array.isArray(req.body?.deckKeys) ? req.body.deckKeys : [];
    if (rawKeys.length > MAX_KEYS) {
      return res.status(400).json({ error: `deckKeys max ${MAX_KEYS}` });
    }
    const deckKeys = rawKeys.filter((key) => typeof key === 'string' && key.length <= 200);
    const counts = {};

    if (!deckKeys.length) {
      return res.status(200).json({ counts: {} });
    }

    const cloudIds = [];
    const allDeckIds = [];
    const nonCloudKeys = [];

    for (const key of deckKeys) {
      const parsed = parseDeckKey(key);
      if (!parsed) {
        counts[key] = 0;
        continue;
      }

      if (parsed.type === 'cloud') {
        cloudIds.push(parsed.id);
      } else if (parsed.type === 'alldeck') {
        allDeckIds.push(parsed.id);
      } else {
        nonCloudKeys.push(parsed.deckKey);
      }
    }

    const allDeckCounts = new Map();
    if (allDeckIds.length) {
      const rows = await prisma.allDeck.findMany({
        where: { id: { in: allDeckIds } },
        select: { id: true, downloadCount: true },
      });

      rows.forEach((row) => {
        allDeckCounts.set(row.id, Number(row.downloadCount ?? 0));
      });
    }

    const cloudCounts = new Map();
    if (cloudIds.length) {
      const deckRows = await prisma.userDeck.findMany({
        where: { id: { in: cloudIds } },
        select: { id: true, downloadCount: true },
      });

      deckRows.forEach((row) => {
        cloudCounts.set(row.id, Number(row.downloadCount ?? 0));
      });
    }

    const deckDownloadCounts = new Map();
    if (nonCloudKeys.length) {
      const rows = await prisma.deckDownload.findMany({
        where: { deckKey: { in: nonCloudKeys } },
        select: { deckKey: true, count: true },
      });

      rows.forEach((row) => {
        deckDownloadCounts.set(row.deckKey, Number(row.count ?? 0));
      });
    }

    for (const key of deckKeys) {
      const parsed = parseDeckKey(key);
      if (!parsed) {
        counts[key] = 0;
        continue;
      }

      if (parsed.type === 'cloud') {
        counts[key] = cloudCounts.get(parsed.id) ?? 0;
      } else if (parsed.type === 'alldeck') {
        counts[key] = allDeckCounts.get(parsed.id) ?? 0;
      } else {
        counts[key] = deckDownloadCounts.get(parsed.deckKey) ?? 0;
      }
    }

    return res.status(200).json({ counts });
  } catch (e) {
    sendServerError(res, '/api/decks/downloads/batch', e);
  }
};
