// Estado unificado de acceso premium (suscripción válida o trial activo)
const { prisma } = require('../lib/prisma');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  if (process.env.APP_BACKEND_SECRET && req.headers['x-app-secret'] !== process.env.APP_BACKEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

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
