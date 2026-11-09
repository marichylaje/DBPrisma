const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Inicia un trial de N días (default 15). Si ya fue concedido, devuelve el existente.
const { requireOwner } = require('../../lib/auth');
const { readTrialDevice, resolveDeviceTrial } = require('../../lib/deviceTrial');
const { checkRateLimitTiers } = require('../../lib/rateLimit');
const { sendServerError } = require('../../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const auth = requireOwner(req, res);
    if (!auth) return;
    const device = readTrialDevice(req, res, auth);
    if (!device) return;
    if (!device.deviceId) {
      return res.status(428).json({
        error: 'mobile_device_required',
        message: 'Actualiza la app movil para iniciar la prueba gratuita.',
      });
    }
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

    res.setHeader('Cache-Control', 'no-store');
    const { trial } = await resolveDeviceTrial(auth, device.deviceId, { start: true });
    res.json(trial);
  } catch (e) {
    sendServerError(res, '/api/trial/start', e);
  }
};
