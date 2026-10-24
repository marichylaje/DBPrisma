const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Inicia un trial de N días (default 15). Si ya fue concedido, devuelve el existente.
const { prisma } = require('../../lib/prisma');
const { requireOwner } = require('../../lib/auth');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { resolveOwnerRecord } = require('../../lib/userLookup');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    // Evita abuso de trials gratuitos (múltiples trials por IP) aunque generen otra sesión de dispositivo.
    const tiersOk = await checkRateLimitTiers(
      req,
      res,
      'trial-start',
      [
        { id: 'burst', limit: 3, windowSeconds: 30 },
        { id: 'sustained', limit: 5, windowSeconds: 86400 },
      ],
      { failClosed: true },
    );
    if (!tiersOk) return;

    const { userKey, nickname } = await resolveOwnerRecord(auth);

    const ent = await prisma.userEntitlement.findUnique({ where: { userKey } });
    if (ent?.trialGranted) {
      return res.json({
        alreadyGranted: true,
        startMs: ent.trialStart ? ent.trialStart.getTime() : null,
        expiryMs: ent.trialExpiry ? ent.trialExpiry.getTime() : null,
      });
    }

    // Duración de trial fijada en servidor; el cliente NO puede modificarla (evita abuso de trial infinito).
    const nDays = Number(process.env.TRIAL_DAYS) > 0 ? Number(process.env.TRIAL_DAYS) : 15;
    const now = Date.now();
    const expiry = new Date(now + nDays * 24 * 60 * 60 * 1000);

    const saved = await prisma.userEntitlement.upsert({
      where: { userKey },
      create: {
        userKey,
        nickname,
        trialGranted: true,
        trialStart: new Date(now),
        trialExpiry: expiry,
      },
      update: {
        nickname,
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
  } catch (e) {
    sendServerError(res, '/api/trial/start', e);
  }
};
