const { applyCors, handleCorsPreflight } = require(process.cwd() + "/lib/cors");
const { prisma } = require("../../lib/prisma");
const { requireOwner } = require("../../lib/auth");
const { getJsonBody } = require("../../lib/requestBody");
const { checkWriteRateLimit } = require("../../lib/rateLimit");
const { parseOrReject, deckRefPayload } = require("../../lib/validate");
const { sendServerError } = require("../../lib/httpError");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== "POST" && req.method !== "DELETE")
      return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    if (!(await checkWriteRateLimit(req, res, "clouddecks-delete"))) return;

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
    const payload = parseOrReject(res, deckRefPayload, body);
    if (!payload) return;

    const { id, deckName } = payload;
    const result = await prisma.cloudDeck.deleteMany({
      where: id
        ? { id, userKey: auth.userKey }
        : { deckName, userKey: auth.userKey },
    });

    res.status(200).json({ ok: true, deleted: result.count });
  } catch (e) {
    sendServerError(res, "/api/clouddecks/delete", e);
  }
};
