const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    const collection = await prisma.userCollection.findUnique({
      where: { userKey: auth.userKey },
    });

    res.status(200).json({
      ok: true,
      cards: collection ? collection.cards : [],
    });
  } catch (e) {
    sendServerError(res, '/api/collection/get', e);
  }
};
