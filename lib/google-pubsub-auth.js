// Verifica el token OIDC que Google Cloud Pub/Sub adjunta en el header Authorization
// cuando la suscripción push está configurada con una cuenta de servicio (push authentication).
// Esto reemplaza al header x-app-secret para este endpoint: Google es quien firma el token,
// no nuestro backend, así que la validación es contra las claves públicas de Google.
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client();

/**
 * Verifica el ID token de un request push de Pub/Sub.
 * Requiere GOOGLE_PUBSUB_AUDIENCE (la URL pública de este webhook, la misma configurada
 * como "push endpoint" en la suscripción de Pub/Sub).
 * Opcionalmente valida que el token fue emitido para la cuenta de servicio esperada
 * (GOOGLE_PUBSUB_INVOKER_SA), lo cual es la recomendación de Google para push endpoints públicos.
 */
async function verifyPubSubPushToken(authorizationHeader) {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  if (!audience) {
    throw new Error('google_pubsub_config_missing: GOOGLE_PUBSUB_AUDIENCE no configurado');
  }
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new Error('google_pubsub_unauthorized: falta el header Authorization Bearer');
  }
  const idToken = authorizationHeader.slice('Bearer '.length);

  const ticket = await client.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();

  const issuer = payload && payload.iss;
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('google_pubsub_unauthorized: issuer inesperado');
  }

  const expectedInvoker = process.env.GOOGLE_PUBSUB_INVOKER_SA;
  if (expectedInvoker && payload.email !== expectedInvoker) {
    throw new Error('google_pubsub_unauthorized: cuenta de servicio invocadora inesperada');
  }

  return payload;
}

module.exports = { verifyPubSubPushToken };
