const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { checkSecret, issueUserToken } = require('../lib/auth');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimitTiers } = require('../lib/rateLimit');
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;
    // Evita creación masiva de cuentas / enumeración de usuarios y emails desde una misma IP
    // (ráfaga corta + tope sostenido por hora).
    const tiersOk = await checkRateLimitTiers(req, res, 'auth-register', [
      { id: 'burst', limit: 3, windowSeconds: 10 },
      { id: 'sustained', limit: 5, windowSeconds: 3600 },
    ]);
    if (!tiersOk) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { username, email, password } = payload || {};

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }

    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();

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
    const passwordHash = hashPassword(password);

    const user = await prisma.user.create({
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

    const token = issueUserToken(user);
    res.status(201).json({ ok: true, userId: user.id, user, token });
  } catch (e) {
    console.error('❌ /api/auth-register error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
