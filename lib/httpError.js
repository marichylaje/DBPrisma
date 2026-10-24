const crypto = require('crypto');

/**
 * Respuesta 500 genérica: el detalle del error solo va al log del servidor,
 * nunca al cliente (evita filtrar mensajes de Prisma, rutas o SQL).
 */
function sendServerError(res, tag, error) {
  const requestId = crypto.randomBytes(6).toString('hex');
  console.error(`❌ ${tag} [${requestId}]`, error);
  if (res.headersSent) return undefined;
  return res.status(500).json({ error: 'internal_error', requestId });
}

module.exports = { sendServerError };
