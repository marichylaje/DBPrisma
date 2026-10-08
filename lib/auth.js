// lib/auth.js
const jwt = require('jsonwebtoken');

function checkSecret(req, res) {
  const expected = process.env.APP_BACKEND_SECRET;
  const got = req.headers['x-app-secret'];
  if (!expected || got !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function getJwtSecret() {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret) {
    throw new Error('auth_config_missing: APP_JWT_SECRET no configurado');
  }
  return secret;
}

function issueUserToken(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      nickname: user.nickname,
    },
    secret,
    { expiresIn: '7d' },
  );
}

function parseBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function requireUser(req, res, options = {}) {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (e) {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }

  if (options.roles && options.roles.length > 0 && !options.roles.includes(payload.role)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }

  return {
    userId: String(payload.sub || ''),
    role: payload.role || null,
    nickname: payload.nickname || null,
  };
}

module.exports = {
  checkSecret,
  issueUserToken,
  requireUser,
};