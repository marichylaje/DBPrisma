const crypto = require('crypto');
const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { requireUser } = require('../lib/auth');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimit, checkRateLimitTiers } = require('../lib/rateLimit');
const { parseOrReject, verifyEmailPayload } = require('../lib/validate');
const { requestEmailCode, withVerifiedEmailCode } = require('../lib/authEmail');
const { sendServerError } = require('../lib/httpError');

module.exports = async (req, res) => {
  applyCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleCorsPreflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const auth = requireUser(req, res);
    if (!auth) return;
    if (!await checkRateLimitTiers(req, res, 'auth-verify-email', [
      { id: 'burst', limit: 5, windowSeconds: 60 },
      { id: 'sustained', limit: 20, windowSeconds: 3600 },
    ], { failClosed: true })) return;
    let body;
    try {
      body = getJsonBody(req);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    const payload = parseOrReject(res, verifyEmailPayload, body);
    if (!payload) return;
    const user = await prisma.user.findFirst({
      where: { id: auth.userId, passwordHash: { not: null } },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user?.email) return res.status(409).json({ error: 'account_email_unavailable' });
    if (user.emailVerifiedAt) return res.status(200).json({ ok: true, emailVerified: true });
    const email = user.email.trim().toLowerCase();
    if (payload.action === 'send') {
      if (!await checkRateLimit(req, res, {
        name: 'auth-email-recipient',
        identity: crypto.createHash('sha256').update(email).digest('hex'),
        limit: 5, windowSeconds: 3600, failClosed: true,
      })) return;
      await requestEmailCode(email, 'verify', payload.language, auth.userId);
      return res.status(200).json({ ok: true, emailVerified: false, retryAfterSeconds: 60 });
    }
    const result = await withVerifiedEmailCode(email, 'verify', payload.code, async (tx, challenge) => {
      if (challenge.userId !== auth.userId) return null;
      const updated = await tx.user.updateMany({
        where: { id: auth.userId, email: { equals: email, mode: 'insensitive' }, passwordHash: { not: null } },
        data: { emailVerifiedAt: new Date() },
      });
      return updated.count === 1 ? true : null;
    });
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(200).json({ ok: true, emailVerified: true });
  } catch (error) {
    return sendServerError(res, '/api/auth-verify-email', error);
  }
};
