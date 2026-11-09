/**
 * Extiende el trial (UserEntitlement.trialExpiry) de todos los usuarios con trial concedido
 * hasta la fecha indicada en TRIAL_EXPIRY_DATE.
 *
 * Uso:
 *   1. Cambia TRIAL_EXPIRY_DATE (formato dd-MM-yyyy) cada vez que lo ejecutes.
 *   2. node scripts/extend-trial.js           -> muestra el resumen y pide confirmación.
 *      node scripts/extend-trial.js --dry-run -> solo muestra el resumen (no modifica nada).
 *
 * - Solo se actualizan filas con trialGranted = true cuyo trialExpiry sea anterior a la nueva
 *   fecha (nunca se acorta un trial que ya llega más lejos).
 * - La fecha se fija al final de ese día (23:59:59.999 UTC).
 * - Usa DIRECT_DATABASE_URL (o DATABASE_URL) del .env => ¡opera sobre la base de datos real!
 */
require('dotenv').config();
const readline = require('readline');

const TRIAL_EXPIRY_DATE = '24-11-2026'; // dd-MM-yyyy

const { prisma } = require('../lib/prisma');

function parseDate(value) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value).trim());
  if (!m) throw new Error(`Formato inválido "${value}". Usa dd-MM-yyyy (ej: 24-11-2026).`);
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
    throw new Error(`Fecha inexistente: ${value}`);
  }
  return date;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  const newExpiry = parseDate(TRIAL_EXPIRY_DATE);
  if (newExpiry.getTime() <= Date.now()) throw new Error('La fecha debe ser futura.');

  const where = {
    trialGranted: true,
    sharedTrialKey: null,
    OR: [{ trialExpiry: null }, { trialExpiry: { lt: newExpiry } }],
  };

  const [total, granted, toUpdate] = await Promise.all([
    prisma.userEntitlement.count(),
    prisma.userEntitlement.count({ where: { trialGranted: true } }),
    prisma.userEntitlement.count({ where }),
  ]);

  console.log(`Nueva fecha de expiración: ${newExpiry.toISOString()}`);
  console.log(`Entitlements totales: ${total} | con trial concedido: ${granted} | a actualizar: ${toUpdate}`);

  if (process.argv.includes('--dry-run')) {
    console.log('Dry-run: no se modificó nada.');
    return;
  }
  if (toUpdate === 0) {
    console.log('Nada que actualizar.');
    return;
  }

  const answer = await ask(`Escribe "${TRIAL_EXPIRY_DATE}" para confirmar: `);
  if (answer !== TRIAL_EXPIRY_DATE) {
    console.log('Cancelado.');
    return;
  }

  const result = await prisma.userEntitlement.updateMany({ where, data: { trialExpiry: newExpiry } });
  console.log(`✅ trialExpiry actualizado en ${result.count} trials originales (incluye sus cuentas y dispositivos vinculados).`);
}

main()
  .catch((e) => {
    console.error('❌', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
