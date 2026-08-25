const ALLOWED_ORIGINS = new Set(['http://localhost:8090']);

function resolveOrigin(req) {
  const origin = req.headers.origin;
  const vercelEnv = process.env.VERCEL_ENV;
  const isDevelopment = process.env.NODE_ENV !== 'production' || vercelEnv !== 'production';

  if (!origin) return '*';
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (isDevelopment) return '*';

  return origin;
}

function applyCors(req, res) {
  const allowOrigin = resolveOrigin(req);

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
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