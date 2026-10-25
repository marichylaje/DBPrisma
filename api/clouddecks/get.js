const { applyCors, handleCorsPreflight } = require(process.cwd() + "/lib/cors");
const { prisma } = require("../../lib/prisma");
const { requireOwner } = require("../../lib/auth");
const { sendServerError } = require("../../lib/httpError");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== "GET") return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    const id =
      typeof req.query.id === "string" && req.query.id ? req.query.id : null;
    const deckName =
      typeof req.query.deckName === "string" && req.query.deckName
        ? req.query.deckName
        : null;
    if (!id && !deckName)
      return res.status(400).json({ error: "id_or_deckName_required" });

    const deck = id
      ? await prisma.cloudDeck.findFirst({
          where: { id, userKey: auth.userKey },
        })
      : await prisma.cloudDeck.findUnique({
          where: { userKey_deckName: { userKey: auth.userKey, deckName } },
        });

    if (!deck) return res.status(404).json({ error: "not_found" });

    const responseDeck = {
      ...deck,
      sideboard: Array.isArray(deck.sideboard) ? deck.sideboard : [],
      commander: { name: deck.commanderName, id: deck.commanderId },
      partner: deck.partnerName
        ? { name: deck.partnerName, id: deck.partnerId }
        : null,
    };

    res.status(200).json({ deck: responseDeck });
  } catch (e) {
    sendServerError(res, "/api/clouddecks/get", e);
  }
};
