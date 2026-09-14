const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Muestra SOLO el estado del trial (no mezcla con suscripciÃ³n)
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  if (!checkSecret(req, res)) return;

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

