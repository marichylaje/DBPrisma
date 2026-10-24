const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Muestra SOLO el estado del trial (no mezcla con suscripción)
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

    const ent = await prisma.userEntitlement.findUnique({ where: { userKey: auth.userKey } });
    const now = Date.now();

    const trialGranted = !!ent?.trialGranted;
    const trialActive =
      !!(ent?.trialGranted && ent?.trialExpiry && ent.trialExpiry.getTime() > now);

    res.json({
      trialGranted,
      active: trialActive,
      startMs: ent?.trialStart ? ent.trialStart.getTime() : null,
      expiryMs: trialActive ? ent.trialExpiry.getTime() : null,
    });
  } catch (e) {
    sendServerError(res, '/api/trial/status', e);
  }
};
