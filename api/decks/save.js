const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { requireOwner } = require('../../lib/auth');
const { getJsonBody } = require('../../lib/requestBody');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { checkWriteRateLimit } = require('../../lib/rateLimit');
const { parseOrReject, userDeckSavePayload } = require('../../lib/validate');
const { sendServerError } = require('../../lib/httpError');
const { serializable } = require('../../lib/transaction');
const { enforceDeckQuota, sendDeckQuotaError } = require('../../lib/deckQuota');

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
      deckData,
      deckId = null,
      oldDeckName = null,
    } = payload;

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId || null;
    const finalPartnerName = partner?.name || pName || null;
    const finalPartnerId = partner?.id || pId || null;

    // El dueño sale del JWT; nunca del body.
    const owner = await resolveOwnerRecord(auth);
    const { userKey, userId, nickname } = owner;
    const normalizedSideboard = Array.isArray(sideboard) ? sideboard : [];
    const deckDataPayload =
      deckData && typeof deckData === 'object'
        ? deckData
        : {
            cards,
            commander: finalCommanderName
              ? { id: finalCommanderId, name: finalCommanderName }
              : null,
            partner: finalPartnerName
              ? { id: finalPartnerId, name: finalPartnerName }
              : null,
            sideboard: normalizedSideboard,
          };

    const data = {
      nickname,
      userId,
      deckName,
      deckDescription,
      instagram,
      commanderName: finalCommanderName || null,
      commanderId: finalCommanderId,
      partnerName: finalPartnerName,
      partnerId: finalPartnerId,
      cards,
      sideboard: normalizedSideboard,
      deckData: deckDataPayload,
    };

    const composite = oldDeckName || deckName;
    const saved = await serializable(async (tx) => {
      const existing = deckId
        ? await tx.userDeck.findFirst({ where: { id: deckId, userKey } })
        : await tx.userDeck.findUnique({
            where: { userKey_deckName: { userKey, deckName: composite } },
          });
      if (deckId && !existing) return null;
      await enforceDeckQuota(tx, userKey, 'userDeck', existing?.deckName, deckName);
      return existing
        ? tx.userDeck.update({ where: { id: existing.id }, data })
        : tx.userDeck.create({ data: { userKey, ...data } });
    });
    if (!saved) return res.status(404).json({ error: 'not_found' });
    res.status(200).json({ ok: true, deck: saved });
  } catch (e) {
    if (sendDeckQuotaError(res, e)) return;
    sendServerError(res, '/api/decks/save', e);
  }
};
