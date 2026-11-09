const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
// Muestra SOLO el estado del trial (no mezcla con suscripción)
const { requireOwner } = require('../../lib/auth');
const { readTrialDevice, resolveDeviceTrial } = require('../../lib/deviceTrial');
const { sendServerError } = require('../../lib/httpError');

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
    const { trial } = await resolveDeviceTrial(auth, device.deviceId);
    res.json(trial);
  } catch (e) {
    sendServerError(res, '/api/trial/status', e);
  }
};
