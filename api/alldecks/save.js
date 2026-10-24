const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { parseOrReject, deckPayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');

const MIN_CARDS = 97;
const MAX_CARDS = 103;

function sumCards(entries) {
  return entries.reduce((sum, entry) => sum + (Number(entry?.count) || 0), 0);
}

/**
 * POST /api/alldecks/save
 * Publica (upsert por userKey + deckName) un deck en la tabla AllDecks. Solo se aceptan
 * decks de 97-103 cartas (commander + partner + cards); fuera de ese rango se responde 422
 * y el cliente debe usar /api/alldecks/delete para retirarlo del listado.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, 'alldecks-save'))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    const payload = parseOrReject(res, deckPayload, body);
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
    } = payload;

    const commanderName = commander?.name || cName;
    const commanderId = commander?.id || cId || null;
    const partnerName = partner?.name || pName || null;
    const partnerId = partner?.id || pId || null;

    if (!commanderName) {
      return res.status(400).json({ error: 'commander name is required' });
    }

    const cardCount = sumCards(cards) + 1 + (partnerName ? 1 : 0);
    if (cardCount < MIN_CARDS || cardCount > MAX_CARDS) {
      return res
        .status(422)
        .json({ error: 'card_count_out_of_range', cardCount, min: MIN_CARDS, max: MAX_CARDS });
    }

    const { userKey, userId, nickname } = await resolveOwnerRecord(auth);
    const data = {
      nickname,
      userId,
      deckDescription,
      instagram,
      commanderName,
      commanderId,
      partnerName,
      partnerId,
      cards,
      sideboard,
      cardCount,
    };

    // Misma cuenta en varios dispositivos: un deck con el mismo nombre se actualiza en vez de duplicarse.
    const existing = userId
      ? await prisma.allDeck.findFirst({ where: { userId, deckName } })
      : null;

    const deck = existing
      ? await prisma.allDeck.update({ where: { id: existing.id }, data: { ...data, userKey } })
      : await prisma.allDeck.upsert({
          where: { userKey_deckName: { userKey, deckName } },
          create: { userKey, deckName, ...data },
          update: data,
        });

    res.status(200).json({ ok: true, deck });
  } catch (e) {
    sendServerError(res, '/api/alldecks/save', e);
  }
};
