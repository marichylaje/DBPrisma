const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimit, checkRateLimitTiers } = require('../lib/rateLimit');
const crypto = require('crypto');
const { parseOrReject, emailCodePayload } = require('../lib/validate');
const { requestEmailCode } = require('../lib/authEmail');
const { sendServerError } = require('../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await checkRateLimitTiers(req, res, 'auth-email-code', [
      { id: 'burst', limit: 3, windowSeconds: 60 },
      { id: 'sustained', limit: 10, windowSeconds: 3600 },
    ], { failClosed: true })) return;
    let body;
    try {
      body = getJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    const payload = parseOrReject(res, emailCodePayload, body);
    if (!payload) return;
    if (!await checkRateLimit(req, res, {
      name: 'auth-email-recipient',
      identity: crypto.createHash('sha256').update(payload.email).digest('hex'),
      limit: 5,
      windowSeconds: 3600,
      failClosed: true,
    })) return;
    await requestEmailCode(payload.email, payload.purpose, payload.language);
    // Misma respuesta para cuentas existentes, inexistentes y reenvios en cooldown.
    return res.status(200).json({ ok: true, retryAfterSeconds: 60 });
  } catch (error) {
    return sendServerError(res, '/api/auth-email-code', error);
  }
};
