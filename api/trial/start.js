// Inicia un trial de N días (default 5). Si ya fue concedido, devuelve el existente.
const { prisma } = require('../../lib/prisma');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.APP_BACKEND_SECRET && req.headers['x-app-secret'] !== process.env.APP_BACKEND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { userKey, days } = req.body || {};
  if (!userKey) return res.status(400).json({ error: 'userKey required' });

  const ent = await prisma.userEntitlement.findUnique({ where: { userKey } });
  if (ent?.trialGranted) {
    return res.json({
      alreadyGranted: true,
      startMs: ent.trialStart ? ent.trialStart.getTime() : null,
      expiryMs: ent.trialExpiry ? ent.trialExpiry.getTime() : null,
    });
  }

  const nDays = Number.isFinite(Number(days)) ? Number(days) : 5;
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
