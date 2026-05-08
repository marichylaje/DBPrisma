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
      commander = {},
      commanderName: cName, // soporte plano
      commanderId: cId,     // soporte plano
      partner = null,
      partnerName: pName,   // soporte plano
      partnerId: pId,       // soporte plano
      cards = [],
      deckId = null,
      oldDeckName = null
    } = req.body || {};

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId;
    const finalPartnerName = partner?.name || pName;
    const finalPartnerId = partner?.id || pId;

    if (!userKey || !deckName) {
      return res.status(400).json({ error: 'userKey and deckName are required' });
    }
    if (!finalCommanderName) {
      return res.status(400).json({ error: 'commander name is required' });
    }
    if (!Array.isArray(cards)) {
      return res.status(400).json({ error: 'cards must be an array' });
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
          commanderName: finalCommanderName,
          commanderId: finalCommanderId ?? null,
          partnerName: finalPartnerName ?? null,
          partnerId: finalPartnerId ?? null,
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
        commanderName: finalCommanderName,
        commanderId: finalCommanderId ?? null,
        partnerName: finalPartnerName ?? null,
        partnerId: finalPartnerId ?? null,
        cards,
      },
      update: {
        deckName, // permite renombrar (si usaste oldDeckName)
        deckDescription,
        instagram,
        commanderName: finalCommanderName,
        commanderId: finalCommanderId ?? null,
        partnerName: finalPartnerName ?? null,
        partnerId: finalPartnerId ?? null,
        cards,
      },
    });

    res.status(200).json({ ok: true, deck: upserted });
  } catch (e) {
    console.error('❌ /api/decks/save', e);
    res.status(500).json({ error: 'failed' });
  }
};
