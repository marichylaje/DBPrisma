// lib/auth.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'mtg-deckbuilder-api';
const JWT_AUDIENCE = 'mtg-deckbuilder-app';
const MIN_SECRET_LENGTH = 32;

const USER_TOKEN_TTL = '7d';
const DEVICE_TOKEN_TTL = '365d';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Mantiene un tiempo de comparación similar aunque las longitudes difieran.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function getJwtSecret() {
  const secret = process.env.APP_JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`auth_config_invalid: APP_JWT_SECRET debe tener al menos ${MIN_SECRET_LENGTH} caracteres`);
  }
  return secret;
}

function parseBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

/**
 * Autenticación server-to-server (cron, GitHub Actions, scripts de operación).
 * Acepta `x-app-secret: <ADMIN_SECRET>` o `Authorization: Bearer <CRON_SECRET>` (Vercel Cron).
 * Estos secretos NUNCA deben viajar en la app móvil.
 */
function checkAdminSecret(req, res) {
  const adminSecret = process.env.ADMIN_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = req.headers['x-app-secret'];
  const bearer = parseBearerToken(req);

  const okAdmin = Boolean(adminSecret) && Boolean(headerSecret) && safeEqual(headerSecret, adminSecret);
  const okCron = Boolean(cronSecret) && Boolean(bearer) && safeEqual(bearer, cronSecret);

  if (!okAdmin && !okCron) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function signToken(payload, expiresIn) {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn,
  });
}

function issueUserToken(user) {
  return signToken(
    {
      sub: user.id,
      kind: 'user',
      role: user.role,
      nickname: user.nickname,
    },
    USER_TOKEN_TTL,
  );
}

function generateDeviceKey() {
  return `dev_${crypto.randomBytes(16).toString('hex')}`;
}

// Sesión anónima: el servidor genera el userKey, por lo que el cliente no puede suplantar a otro.
function issueDeviceToken(userKey) {
  return signToken({ sub: userKey, kind: 'device' }, DEVICE_TOKEN_TTL);
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/**
 * Valida un token sin responder. Devuelve { sub, kind, role, nickname } o null.
 */
function decodeVerifiedToken(token) {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    const sub = String(payload.sub || '');
    if (!sub || (payload.kind !== 'user' && payload.kind !== 'device')) return null;
    return {
      sub,
      kind: payload.kind,
      role: payload.role || null,
      nickname: payload.nickname || null,
    };
  } catch {
    return null;
  }
}

function authenticate(req, res) {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return null;
  }
  const decoded = decodeVerifiedToken(token);
  if (!decoded) {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
  return decoded;
}

/**
 * Exige una cuenta registrada (kind=user). Los tokens de dispositivo no sirven aquí.
 */
function requireUser(req, res, options = {}) {
  const decoded = authenticate(req, res);
  if (!decoded) return null;

  if (decoded.kind !== 'user') {
    res.status(403).json({ error: 'forbidden_account_required' });
    return null;
  }

  if (options.roles && options.roles.length > 0 && !options.roles.includes(decoded.role)) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }

  return {
    userId: decoded.sub,
    role: decoded.role,
    nickname: decoded.nickname,
  };
}

/**
 * Identifica al dueño de los datos (cuenta o dispositivo anónimo). `userKey` sale SIEMPRE
 * del token y nunca del body/query, para que un cliente no pueda leer/escribir datos ajenos.
 */
function requireOwner(req, res) {
  const decoded = authenticate(req, res);
  if (!decoded) return null;

  return {
    userKey: decoded.sub,
    userId: decoded.kind === 'user' ? decoded.sub : null,
    kind: decoded.kind,
    role: decoded.role,
  };
}

module.exports = {
  checkAdminSecret,
  decodeVerifiedToken,
  generateDeviceKey,
  issueDeviceToken,
  issueUserToken,
  parseBearerToken,
  requireOwner,
  requireUser,
};
