const { applyCors, handleCorsPreflight } = require(process.cwd() + "/lib/cors");
const { prisma } = require("../../lib/prisma");
const { requireOwner } = require("../../lib/auth");
const { getJsonBody } = require("../../lib/requestBody");
const { resolveOwnerRecord } = require("../../lib/userLookup");
const { checkWriteRateLimit } = require("../../lib/rateLimit");
const { parseOrReject, deckPayload } = require("../../lib/validate");
const { sendServerError } = require("../../lib/httpError");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== "POST") return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, "clouddecks-save"))) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res
        .status(400)
        .json({
          error: "invalid_json",
          message: "Request body must be valid JSON",
        });
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
      oldDeckName = null,
    } = payload;

    const finalCommanderName = commander?.name || cName;
    const finalCommanderId = commander?.id || cId || null;
    const finalPartnerName = partner?.name || pName || null;
    const finalPartnerId = partner?.id || pId || null;

    if (!finalCommanderName) {
      return res.status(400).json({ error: "commander_name_required" });
    }

    const owner = await resolveOwnerRecord(auth);
    const { userKey, userId, nickname } = owner;
    const composite = oldDeckName || deckName;

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
      sideboard: Array.isArray(sideboard) ? sideboard : [],
    };

    const upserted = await prisma.cloudDeck.upsert({
      where: { userKey_deckName: { userKey, deckName: composite } },
      create: { userKey, ...data },
      update: data,
    });

    res.status(200).json({ ok: true, deck: upserted });
  } catch (e) {
    sendServerError(res, "/api/clouddecks/save", e);
  }
};
