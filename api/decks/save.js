const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { parseOrReject, userDeckSavePayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, 'decks-save'))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const payload = parseOrReject(res, userDeckSavePayload, body);
    if (!payload) return;

    const {
      deckName,
      deckDescription = null,
      instagram = null,
      commander,
      commanderName: cName,
      commanderId: cId,
      partner,
      partnerName: pName,
      partnerId: pId,
      cards,
      sideboard,
      deckId = null,
      oldDeckName = null,
    } = payload;

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId || null;
    const finalPartnerName = partner?.name || pName || null;
    const finalPartnerId = partner?.id || pId || null;

    if (!finalCommanderName) {
      return res.status(400).json({ error: 'commander name is required' });
    }

    // El dueño sale del JWT; nunca del body.
    const owner = await resolveOwnerRecord(auth);
    const { userKey, userId, nickname } = owner;

    const data = {
      nickname,
      userId,
      deckName,
      deckDescription,
      instagram,
      commanderName: finalCommanderName,
      commanderId: finalCommanderId,
      partnerName: finalPartnerName,
      partnerId: finalPartnerId,
      cards,
      sideboard,
    };

    // Modo A: actualizar por id, solo si el deck pertenece al dueño autenticado.
    if (deckId) {
      const existing = await prisma.userDeck.findFirst({ where: { id: deckId, userKey } });
      if (!existing) return res.status(404).json({ error: 'not_found' });

      const updated = await prisma.userDeck.update({ where: { id: existing.id }, data });
      return res.status(200).json({ ok: true, deck: updated });
    }

    // Modo B: upsert por (userKey, oldDeckName|deckName).
    const composite = oldDeckName || deckName;

    const upserted = await prisma.userDeck.upsert({
      where: { userKey_deckName: { userKey, deckName: composite } },
      create: { userKey, ...data },
      update: data,
    });

    res.status(200).json({ ok: true, deck: upserted });
  } catch (e) {
    sendServerError(res, '/api/decks/save', e);
  }
};
