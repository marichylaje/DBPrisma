const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Estado unificado de acceso premium (suscripción válida o trial activo)
const { prisma } = require('../lib/prisma');
const { requireOwner } = require('../lib/auth');
const { sendServerError } = require('../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    const ent = await prisma.userEntitlement.findUnique({ where: { userKey: auth.userKey } });
    const now = Date.now();

    const subActive =
      !!(ent?.subActive && ent?.subExpiry && ent.subExpiry.getTime() > now);
    const trialActive =
      !!(ent?.trialGranted && ent?.trialExpiry && ent.trialExpiry.getTime() > now);

    const source = subActive ? 'subscription' : trialActive ? 'trial' : 'none';
    const expiryMs = subActive
      ? ent.subExpiry.getTime()
      : trialActive
      ? ent.trialExpiry.getTime()
      : null;

    res.json({
      active: subActive || trialActive,
      source,
      expiryMs,
    });
  } catch (e) {
    sendServerError(res, '/api/entitlement', e);
  }
};
