const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../../lib/prisma');
const { checkSecret } = require('../../../lib/auth');
const { parseDeckKey } = require('../../../lib/deckDownloads');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const deckKeys = Array.isArray(req.body?.deckKeys) ? req.body.deckKeys : [];
    const counts = {};

    if (!deckKeys.length) {
      return res.status(200).json({ counts: {} });
    }

    const cloudIds = [];
    const nonCloudKeys = [];

    for (const key of deckKeys) {
      const parsed = parseDeckKey(key);
      if (!parsed) {
        counts[key] = 0;
        continue;
      }

      if (parsed.type === 'cloud') {
        cloudIds.push(parsed.id);
      } else {
        nonCloudKeys.push(parsed.deckKey);
      }
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
      } else {
        counts[key] = deckDownloadCounts.get(parsed.deckKey) ?? 0;
      }
    }

    return res.status(200).json({ counts });
  } catch (e) {
    console.error('âŒ /api/decks/downloads/batch', e);
    res.status(500).json({ error: 'failed' });
  }
};

