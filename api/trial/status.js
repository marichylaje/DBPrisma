// Muestra SOLO el estado del trial (no mezcla con suscripción)
const { prisma } = require('../../lib/prisma');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();
  if (process.env.APP_BACKEND_SECRET && req.headers['x-app-secret'] !== process.env.APP_BACKEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const userKey = String(req.query.userKey || '');
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  const ent = await prisma.userEntitlement.findUnique({ where: { userKey } });
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
};
