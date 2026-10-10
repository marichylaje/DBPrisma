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
 * Incrementa (o reinicia si la ventana expiró) el contador asociado a `key` de forma
 * atómica y devuelve la fila resultante ({ count, windowStart }). Lanza si la DB falla;
 * los llamadores deciden la política de fail-open/fail-closed.
 */
async function bump(key, windowSeconds) {
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
  return rows[0];
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
    const row = await bump(key, windowSeconds);
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

/**
 * Variante de `checkRateLimit` con varios "tiers" bajo una misma regla base, pensada
 * para cubrir a la vez ráfagas cortas (burst) y abuso sostenido en el tiempo, p. ej.:
 *   checkRateLimitTiers(req, res, 'auth-login', [
 *     { id: 'burst', limit: 5, windowSeconds: 10 },     // ráfaga: 5 intentos en 10s
 *     { id: 'sustained', limit: 10, windowSeconds: 600 }, // sostenido: 10 intentos en 10min
 *   ])
 * Se evalúan en orden y se corta en el primer tier que exceda su límite (ya responde 429).
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {Array<{ id: string, limit: number, windowSeconds: number }>} tiers
 * @returns {Promise<boolean>}
 */
async function checkRateLimitTiers(req, res, name, tiers) {
  for (const tier of tiers) {
    const ok = await checkRateLimit(req, res, { name: `${name}-${tier.id}`, limit: tier.limit, windowSeconds: tier.windowSeconds });
    if (!ok) return false;
  }
  return true;
}

/**
 * Detección de patrón de abuso por intentos fallidos (p. ej. credential stuffing /
 * fuerza bruta dirigida a una cuenta puntual), independiente de la IP del atacante.
 * A diferencia de `checkRateLimit`, NO incrementa nada: solo consulta si `key` ya
 * alcanzó el límite de fallos dentro de la ventana. Debe combinarse con `recordFailure`.
 *
 * @param {string} key clave estable del recurso objetivo (ej: `login-fail:<usuario>`)
 * @param {number} limit
 * @param {number} windowSeconds
 * @returns {Promise<boolean>} true si está bloqueado por exceso de fallos recientes
 */
async function isFailureLocked(key, limit, windowSeconds) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT "count" FROM "RateLimitHit"
      WHERE "key" = ${key} AND "windowStart" >= now() - make_interval(secs => ${windowSeconds})
    `;
    return Boolean(rows[0] && Number(rows[0].count) >= limit);
  } catch (e) {
    console.error('⚠️ isFailureLocked falló, dejando pasar (fail-open):', e.message);
    return false;
  }
}

/**
 * Registra un fallo (ej. password incorrecto) contra `key`. Usar junto a `isFailureLocked`.
 * @param {string} key
 * @param {number} windowSeconds
 */
async function recordFailure(key, windowSeconds) {
  try {
    await bump(key, windowSeconds);
  } catch (e) {
    console.error('⚠️ recordFailure falló (no bloqueante):', e.message);
  }
}

module.exports = { checkRateLimit, checkRateLimitTiers, isFailureLocked, recordFailure, getClientIp };

