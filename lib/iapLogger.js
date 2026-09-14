// Logging estructurado para el ciclo de vida de IAP (compras, webhooks, reconciliación).
// Objetivo: que cualquier incidente de un usuario de pago (por qué perdió acceso, por qué se
// rechazó su recibo, etc.) se pueda diagnosticar filtrando logs por userKey/source/event,
// en lugar de depender de mensajes de console.log sueltos con formato libre.
//
// No usa una librería externa (Pino/Winston) a propósito: en Vercel los logs ya se capturan
// como stdout por invocación, así que basta con emitir una línea JSON por evento.
function logIapEvent(fields) {
  const line = {
    ts: new Date().toISOString(),
    scope: 'iap',
    ...fields,
  };
  const method = fields.level === 'error' ? console.error : fields.level === 'warn' ? console.warn : console.log;
  method(JSON.stringify(line));
}

module.exports = { logIapEvent };
