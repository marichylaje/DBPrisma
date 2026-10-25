const { applyCors, handleCorsPreflight } = require(process.cwd() + "/lib/cors");
const { prisma } = require("../../lib/prisma");
const { requireOwner } = require("../../lib/auth");
const { lookupNicknames } = require("../../lib/userLookup");
const { sendServerError } = require("../../lib/httpError");

const MAX_OWNER_DECKS = 500;
const MAX_PUBLIC_DECKS = 1000;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== "GET") return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    const hasUserKeyQuery =
      typeof req.query.userKey === "string" &&
      req.query.userKey.trim().length > 0;

    const where = hasUserKeyQuery ? { userKey: auth.userKey } : {};

    const decks = await prisma.cloudDeck.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: hasUserKeyQuery ? MAX_OWNER_DECKS : MAX_PUBLIC_DECKS,
    });

    const missing = decks
      .filter((deck) => !deck.nickname)
      .map((deck) => deck.userId || deck.userKey);
    const nicknames = await lookupNicknames(missing);

    const responseDecks = decks.map((deck) => ({
      ...deck,
      nickname:
        deck.nickname ?? nicknames.get(deck.userId || deck.userKey) ?? null,
      downloadCount: Number(deck.downloadCount ?? 0),
      sideboard: Array.isArray(deck.sideboard) ? deck.sideboard : [],
      commander: deck.commanderName
        ? { name: deck.commanderName, id: deck.commanderId }
        : null,
      partner: deck.partnerName
        ? { name: deck.partnerName, id: deck.partnerId }
        : null,
    }));

    res.status(200).json({ decks: responseDecks });
  } catch (e) {
    sendServerError(res, "/api/clouddecks/list", e);
  }
};
