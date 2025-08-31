const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;

    const {
      userKey,
      deckName,
      deckDescription = null,
      instagram = null,
      commander = {}, // { name, id? }
      partner = null, // { name, id? } | null
      cards = [],     // [{ name, count }]
      deckId = null,  // opcional: actualizar por id explícito
      oldDeckName = null // opcional: renombrar
    } = req.body || {};

    if (!userKey || !deckName) {
      return res.status(400).json({ error: 'userKey and deckName are required' });
    }
    if (!commander?.name) {
      return res.status(400).json({ error: 'commander.name is required' });
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({ error: 'cards array required' });
    }

    // Modo A: actualizar por id si viene
    if (deckId) {
      const updated = await prisma.userDeck.update({
        where: { id: deckId },
        data: {
          userKey,
          deckName,
          deckDescription,
          instagram,
          commanderName: commander.name,
          commanderId: commander.id ?? null,
          partnerName: partner?.name ?? null,
          partnerId: partner?.id ?? null,
          cards,
        },
      });
      return res.status(200).json({ ok: true, deck: updated });
    }

    // Modo B: upsert por (userKey, oldDeckName|deckName)
    const composite = oldDeckName || deckName;

    const upserted = await prisma.userDeck.upsert({
      where: { userKey_deckName: { userKey, deckName: composite } },
      create: {
        userKey,
        deckName,
        deckDescription,
        instagram,
        commanderName: commander.name,
        commanderId: commander.id ?? null,
        partnerName: partner?.name ?? null,
        partnerId: partner?.id ?? null,
        cards,
      },
      update: {
        deckName, // permite renombrar (si usaste oldDeckName)
        deckDescription,
        instagram,
        commanderName: commander.name,
        commanderId: commander.id ?? null,
        partnerName: partner?.name ?? null,
        partnerId: partner?.id ?? null,
        cards,
      },
    });

    res.status(200).json({ ok: true, deck: upserted });
  } catch (e) {
    console.error('❌ /api/decks/save', e);
    res.status(500).json({ error: 'failed' });
  }
};
