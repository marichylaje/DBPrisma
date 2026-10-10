// lib/rateLimit.js
// Rate limiting básico (ventana fija) respaldado por Postgres, para funciones serverless
// que no comparten memoria entre instancias. El contador se actualiza con un UPSERT
// atómico (una sola sentencia SQL), por lo que es seguro ante requests concurrentes.
//
// Esto es una capa de defensa a nivel aplicación. Para protección a nivel edge/WAF
// (antes de que la request llegue a la función), complementar con Vercel Firewall
// (Project > Firewall > Rate Limiting), ver IAP_PRODUCTION_CHECKLIST.md.

const { prisma } = require('./prisma');

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Aplica un límite de solicitudes por IP para una regla dada.
 * Si se excede el límite, responde 429 (con Retry-After) y devuelve false.
 * Si la verificación falla (p. ej. DB caída), deja pasar la request (fail-open)
 * para no tumbar el servicio por un problema del propio limitador.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ name: string, limit: number, windowSeconds: number }} options
 * @returns {Promise<boolean>} true si la request puede continuar
 */
async function checkRateLimit(req, res, { name, limit, windowSeconds }) {
  const ip = getClientIp(req);
  const key = `${name}:${ip}`;

  try {
    const rows = await prisma.$queryRaw`
      INSERT INTO "RateLimitHit" ("key", "count", "windowStart", "updatedAt")
      VALUES (${key}, 1, now(), now())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitHit"."windowStart" < now() - make_interval(secs => ${windowSeconds})
          THEN 1
          ELSE "RateLimitHit"."count" + 1
        END,
        "windowStart" = CASE
          WHEN "RateLimitHit"."windowStart" < now() - make_interval(secs => ${windowSeconds})
          THEN now()
          ELSE "RateLimitHit"."windowStart"
        END,
        "updatedAt" = now()
      RETURNING "count", "windowStart";
    `;

    const row = rows[0];
    if (row && row.count > limit) {
      const resetAtMs = new Date(row.windowStart).getTime() + windowSeconds * 1000;
      const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate_limited', message: 'Demasiadas solicitudes, intenta de nuevo más tarde.' });
      return false;
    }
    return true;
  } catch (e) {
    console.error('⚠️ checkRateLimit falló, dejando pasar la request (fail-open):', e.message);
    return true;
  }
}

module.exports = { checkRateLimit, getClientIp };
