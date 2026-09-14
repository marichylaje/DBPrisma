const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Inicia un trial de N dÃ­as (default 5). Si ya fue concedido, devuelve el existente.
const { prisma } = require('../../lib/prisma');
const { checkSecret } = require('../../lib/auth');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  if (!checkSecret(req, res)) return;

  const { userKey } = req.body || {};
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  const ent = await prisma.userEntitlement.findUnique({ where: { userKey } });
  if (ent?.trialGranted) {
    return res.json({
      alreadyGranted: true,
      startMs: ent.trialStart ? ent.trialStart.getTime() : null,
      expiryMs: ent.trialExpiry ? ent.trialExpiry.getTime() : null,
    });
  }

  // DuraciÃ³n de trial fijada en servidor; el cliente NO puede modificarla (evita abuso de trial infinito).
  const nDays = Number(process.env.TRIAL_DAYS) > 0 ? Number(process.env.TRIAL_DAYS) : 5;
  const now = Date.now();
  const expiry = new Date(now + nDays * 24 * 60 * 60 * 1000);

  const saved = await prisma.userEntitlement.upsert({
    where: { userKey },
    create: {
      userKey,
      trialGranted: true,
      trialStart: new Date(now),
      trialExpiry: expiry,
    },
    update: {
      trialGranted: true,
      trialStart: new Date(now),
      trialExpiry: expiry,
    },
  });

  res.json({
    alreadyGranted: false,
    startMs: saved.trialStart.getTime(),
    expiryMs: saved.trialExpiry.getTime(),
  });
};

