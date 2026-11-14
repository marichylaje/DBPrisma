const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { requireOwner } = require('../../lib/auth');
const { serializable } = require('../../lib/transaction');
const { readDeckQuota, quotaResponse } = require('../../lib/deckQuota');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();
    const auth = requireOwner(req, res);
    if (!auth) return;
    res.setHeader('Cache-Control', 'no-store');
    const quota = await serializable((tx) => readDeckQuota(tx, auth.userKey));
    res.status(200).json(quotaResponse(quota));
  } catch (error) {
    sendServerError(res, '/api/decks/quota', error);
  }
};
