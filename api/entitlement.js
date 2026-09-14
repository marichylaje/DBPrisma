const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Estado unificado de acceso premium (suscripciÃ³n vÃ¡lida o trial activo)
const { prisma } = require('../lib/prisma');
const { checkSecret } = require('../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  if (!checkSecret(req, res)) return;

  const userKey = String(req.query.userKey || '');
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  const ent = await prisma.userEntitlement.findUnique({ where: { userKey } });
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
};

