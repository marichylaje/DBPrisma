const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Estado unificado de acceso premium (suscripción válida o trial activo)
const { requireOwner } = require('../lib/auth');
const { readTrialDevice, resolveDeviceTrial } = require('../lib/deviceTrial');
const { sendServerError } = require('../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;

    res.setHeader('Cache-Control', 'no-store');
    const device = readTrialDevice(req, res, auth);
    if (!device) return;
    const { entitlement: ent, trial } = await resolveDeviceTrial(auth, device.deviceId);
    const now = Date.now();

    const subActive =
      !!(ent?.subActive && ent?.subExpiry && ent.subExpiry.getTime() > now);
    const trialActive = trial.active;

    const source = subActive ? 'subscription' : trialActive ? 'trial' : 'none';
    const expiryMs = subActive
      ? ent.subExpiry.getTime()
      : trialActive
      ? trial.expiryMs
      : null;

    res.json({
      active: subActive || trialActive,
      source,
      expiryMs,
      trialExpiryMs: trial.expiryMs,
    });
  } catch (e) {
    sendServerError(res, '/api/entitlement', e);
  }
};
