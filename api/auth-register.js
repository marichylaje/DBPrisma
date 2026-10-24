const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { issueUserToken } = require('../lib/auth');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimitTiers } = require('../lib/rateLimit');
const { hashPassword } = require('../lib/password');
const { parseOrReject, registerPayload } = require('../lib/validate');
const { sendServerError } = require('../lib/httpError');
const crypto = require('crypto');

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    // Evita creación masiva de cuentas / enumeración de usuarios y emails desde una misma IP
    // (ráfaga corta + tope sostenido por hora).
    const tiersOk = await checkRateLimitTiers(
      req,
      res,
      'auth-register',
      [
        { id: 'burst', limit: 3, windowSeconds: 10 },
        { id: 'sustained', limit: 5, windowSeconds: 3600 },
      ],
      { failClosed: true },
    );
    if (!tiersOk) return;

    let body;
    try {
      body = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }
    const payload = parseOrReject(res, registerPayload, body);
    if (!payload) return;

    const { username: normalizedUsername, email: normalizedEmail, password } = payload;

    // Check username uniqueness (case-insensitive)
    const existingByUsername = await prisma.user.findFirst({
      where: { nickname: { equals: normalizedUsername, mode: 'insensitive' }, passwordHash: { not: null } },
    });
    if (existingByUsername) {
      return res.status(409).json({ error: 'username_taken', message: 'Username already in use' });
    }

    // Check email uniqueness
    const existingByEmail = await prisma.user.findFirst({
      where: { email: normalizedEmail },
    });
    if (existingByEmail) {
      return res.status(409).json({ error: 'email_taken', message: 'Email already in use' });
    }

    const userId = `auth_${crypto.randomBytes(12).toString('hex')}`;
    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          id: userId,
          nickname: normalizedUsername,
          email: normalizedEmail,
          passwordHash,
          role: 'player',
          xp: 0,
          level: 1,
        },
        select: {
          id: true,
          nickname: true,
          email: true,
          role: true,
          xp: true,
          level: true,
          createdAt: true,
        },
      });
    } catch (createError) {
      // Carrera entre dos registros simultáneos con el mismo email.
      if (createError && createError.code === 'P2002') {
        return res.status(409).json({ error: 'email_taken', message: 'Email already in use' });
      }
      throw createError;
    }

    const token = issueUserToken(user);
    res.status(201).json({ ok: true, userId: user.id, user, token });
  } catch (e) {
    sendServerError(res, '/api/auth-register', e);
  }
};
