/**
 * Elimina un usuario y TODOS sus datos relacionados de la base de datos
 * (mazos, colección, wishlist, amistades, friend nights, torneos, analítica, IAP, etc.).
 *
 * Uso:
 *   1. Pon el id/key del usuario en USER_KEY.
 *   2. node scripts/delete-user.js           -> muestra qué se borraría y pide confirmación.
 *      node scripts/delete-user.js --dry-run -> solo muestra el resumen (no borra nada).
 *
 * Usa DIRECT_DATABASE_URL (o DATABASE_URL) del .env => ¡opera sobre la base de datos real!
 */
require('dotenv').config();
const readline = require('readline');

const USER_KEY = ''; // <-- ej: 'auth_0123456789abcdef01234567'

const { prisma } = require('../lib/prisma');
const { purgeUser } = require('../lib/purgeUser');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  const key = USER_KEY.trim();
  if (!key) throw new Error('Define USER_KEY en scripts/delete-user.js');

  const preview = await purgeUser(prisma, key, { dryRun: true });
  console.log(preview.user
    ? `Usuario: ${preview.user.nickname} <${preview.user.email ?? 'sin email'}> (${preview.user.id})`
    : `⚠️ No existe un User con id "${key}"; se borrarán solo datos sueltos ligados a esa key.`);
  console.log('userKeys asociadas:', preview.userKeys.join(', '));
  console.log('Filas a eliminar:');
  console.table(preview.counts);

  if (process.argv.includes('--dry-run')) {
    console.log('Dry-run: no se modificó nada.');
    return;
  }

  const total = Object.values(preview.counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log('Nada que eliminar.');
    return;
  }

  const answer = await ask(`Escribe "${key}" para confirmar el borrado definitivo: `);
  if (answer !== key) {
    console.log('Cancelado.');
    return;
  }

  const result = await purgeUser(prisma, key);
  console.log('✅ Eliminado:');
  console.table(result.counts);
}

main()
  .catch((e) => {
    console.error('❌', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
