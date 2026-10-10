const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { checkSecret, issueUserToken } = require('../lib/auth');
const { getJsonBody } = require('../lib/requestBody');
const { checkRateLimit } = require('../lib/rateLimit');
const crypto = require('crypto');

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const newHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(newHash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();
    if (!checkSecret(req, res)) return;
    // Brute-force protection: pocos intentos de login por IP en ventanas cortas.
    if (!(await checkRateLimit(req, res, { name: 'auth-login', limit: 10, windowSeconds: 600 }))) return;

    let payload;
    try {
      payload = getJsonBody(req);
    } catch (error) {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON' });
    }

    const { username, password } = payload || {};

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'password is required' });
    }

    // Find user by username (case-insensitive), must be a native auth user (has passwordHash)
    const user = await prisma.user.findFirst({
      where: {
        nickname: { equals: username.trim(), mode: 'insensitive' },
        passwordHash: { not: null },
      },
      select: {
        id: true,
        nickname: true,
        email: true,
        role: true,
        xp: true,
        level: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Username or password is incorrect' });
    }

    // Return user without passwordHash
    const { passwordHash: _, ...safeUser } = user;
    const token = issueUserToken(safeUser);
    res.status(200).json({ ok: true, userId: user.id, user: safeUser, token });
  } catch (e) {
    console.error('❌ /api/auth-login error:', e);
    res.status(500).json({ error: 'failed', details: e.message });
  }
};
