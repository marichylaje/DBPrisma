const { applyCors, handleCorsPreflight } = require(process.cwd() + '/lib/cors');
const { prisma } = require('../lib/prisma');
const { issueUserToken } = require('../lib/auth');
const { getJsonBody } = require('../lib/requestBody');
const {
  checkRateLimitTiers,
  getClientIp,
  isFailureLocked,
  recordFailure,
} = require('../lib/rateLimit');
const { DUMMY_HASH, verifyPassword } = require('../lib/password');
const { parseOrReject, loginPayload } = require('../lib/validate');
const { sendServerError } = require('../lib/httpError');

// Bloqueo en dos niveles para no permitir que un tercero bloquee cuentas ajenas:
//  - por cuenta + IP (limite bajo): frena la fuerza bruta desde una IP concreta.
//  - por cuenta global (limite alto): frena ataques distribuidos sin dejar el login inutilizable.
const LOGIN_FAIL_WINDOW_SECONDS = 900; // 15 min
const LOGIN_FAIL_LIMIT_PER_IP = 8;
const LOGIN_FAIL_LIMIT_GLOBAL = 40;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleCorsPreflight(req, res)) return;

  try {
    if (req.method !== 'POST') return res.status(405).end();

    // Fuerza bruta por IP: ráfaga corta + sostenido en el tiempo.
    const tiersOk = await checkRateLimitTiers(
      req,
      res,
      'auth-login',
      [
        { id: 'burst', limit: 5, windowSeconds: 10 },
        { id: 'sustained', limit: 30, windowSeconds: 600 },
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
    const payload = parseOrReject(res, loginPayload, body);
    if (!payload) return;

    const { username, password } = payload;
    const normalized = username.toLowerCase();
    const ip = getClientIp(req);
    const ipFailKey = `login-fail-ip:${normalized}:${ip}`;
    const globalFailKey = `login-fail:${normalized}`;

    const locked =
      (await isFailureLocked(ipFailKey, LOGIN_FAIL_LIMIT_PER_IP, LOGIN_FAIL_WINDOW_SECONDS)) ||
      (await isFailureLocked(globalFailKey, LOGIN_FAIL_LIMIT_GLOBAL, LOGIN_FAIL_WINDOW_SECONDS));
    if (locked) {
      return res.status(423).json({
        error: 'account_temporarily_locked',
        message: 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.',
      });
    }

    // Find user by username (case-insensitive), must be a native auth user (has passwordHash)
    const user = await prisma.user.findFirst({
      where: {
        nickname: { equals: username, mode: 'insensitive' },
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

    // Siempre se calcula el hash (aunque el usuario no exista) para no revelar su existencia por tiempo.
    const passwordOk = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);
    if (!user || !passwordOk) {
      await Promise.all([
        recordFailure(ipFailKey, LOGIN_FAIL_WINDOW_SECONDS),
        recordFailure(globalFailKey, LOGIN_FAIL_WINDOW_SECONDS),
      ]);
      return res.status(401).json({ error: 'invalid_credentials', message: 'Username or password is incorrect' });
    }

    // Return user without passwordHash
    const { passwordHash: _, ...safeUser } = user;
    const token = issueUserToken(safeUser);
    res.status(200).json({ ok: true, userId: user.id, user: safeUser, token });
  } catch (e) {
    sendServerError(res, '/api/auth-login', e);
  }
};
