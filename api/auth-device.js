const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { generateDeviceKey, issueDeviceToken } = require('../lib/auth');
const { checkRateLimitTiers } = require('../lib/rateLimit');
const { sendServerError } = require('../lib/httpError');

/**
 * POST /api/auth-device
 * Emite una sesión anónima: el servidor genera el userKey (no el cliente) y lo firma en un JWT.
 * Todos los endpoints de datos derivan el dueño de ese token.
 */
module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    const ok = await checkRateLimitTiers(
      req,
      res,
      'auth-device',
      [
        { id: 'burst', limit: 5, windowSeconds: 10 },
        { id: 'sustained', limit: 30, windowSeconds: 3600 },
      ],
      { failClosed: true },
    );
    if (!ok) return;

    const userKey = generateDeviceKey();
    const token = issueDeviceToken(userKey);
    res.status(201).json({ ok: true, userKey, token });
  } catch (e) {
    sendServerError(res, '/api/auth-device', e);
  }
};
