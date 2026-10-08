function getAllowedOrigins() {
  const raw = process.env.APP_ALLOWED_ORIGINS || '';
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set(list);
}

function isLocalhostOrigin(origin) {
  return /^https?:\/\/localhost(?::\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(origin);
}

function resolveOrigin(req) {
  const origin = req.headers.origin;
  const vercelEnv = process.env.VERCEL_ENV;
  const isDevelopment = process.env.NODE_ENV !== 'production' || vercelEnv !== 'production';
  const allowedOrigins = getAllowedOrigins();

  if (!origin) return null;
  if (allowedOrigins.has(origin)) return origin;
  if (isDevelopment && isLocalhostOrigin(origin)) return origin;

  return null;
}

function applyCors(req, res) {
  const allowOrigin = resolveOrigin(req);

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-App-Secret, X-Requested-With, Accept, Origin',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleCorsPreflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

module.exports = {
  applyCors,
  handleCorsPreflight,
};