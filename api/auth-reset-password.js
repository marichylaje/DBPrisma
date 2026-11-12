const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimitTiers } = require('../lib/rateLimit');
const { parseOrReject, resetPasswordPayload } = require('../lib/validate');
const { hashPassword } = require('../lib/password');
const { withVerifiedEmailCode } = require('../lib/authEmail');
const { sendServerError } = require('../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!await checkRateLimitTiers(req, res, 'auth-reset-password', [
      { id: 'burst', limit: 5, windowSeconds: 60 },
      { id: 'sustained', limit: 20, windowSeconds: 3600 },
    ], { failClosed: true })) return;
    let body;
    try {
      body = getJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    const payload = parseOrReject(res, resetPasswordPayload, body);
    if (!payload) return;
    const passwordHash = await hashPassword(payload.password);
    const result = await withVerifiedEmailCode(payload.email, 'reset', payload.code, async (tx, challenge) => {
      const updated = await tx.user.updateMany({
        where: { id: challenge.userId, email: { equals: payload.email, mode: 'insensitive' }, passwordHash: { not: null } },
        data: { passwordHash, emailVerifiedAt: new Date() },
      });
      return updated.count === 1 ? true : null;
    });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(200).json({ ok: true, emailVerified: true });
  } catch (error) {
    return sendServerError(res, '/api/auth-reset-password', error);
  }
};
