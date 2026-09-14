// verify_iap_deploy.js
//
// Smoke test post-deploy: golpea los endpoints de IAP/entitlement ya desplegados para confirmar
// que responden correctamente antes de darlo por terminado. No reemplaza pruebas de compra reales
// (sandbox de Apple/Google), solo detecta regresiones obvias (endpoint caído, secret mal
// configurado, CORS roto, etc.) justo después de un deploy.
//
// Uso:
//   BASE_URL=https://tu-dominio.vercel.app APP_BACKEND_SECRET=xxx node verify_iap_deploy.js
require('dotenv').config();

const BASE_URL = process.env.BASE_URL;
const SECRET = process.env.APP_BACKEND_SECRET;

if (!BASE_URL) {
  console.error('❌ Falta BASE_URL (ej: https://tu-dominio.vercel.app)');
  process.exit(1);
}
if (!SECRET) {
  console.error('❌ Falta APP_BACKEND_SECRET');
  process.exit(1);
}

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (e) {
    checks.push({ name, ok: false, error: String((e && e.message) || e) });
    console.error(`❌ ${name}: ${String((e && e.message) || e)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`🔎 Verificando despliegue de IAP contra ${BASE_URL}`);

  await check('GET /api/entitlement responde 200 con secret válido', async () => {
    const res = await fetch(`${BASE_URL}/api/entitlement?userKey=verify_iap_deploy_smoke_test`, {
      headers: { 'x-app-secret': SECRET },
    });
    assert(res.status === 200, `status esperado 200, recibido ${res.status}`);
    const body = await res.json();
    assert(typeof body.active === 'boolean', 'la respuesta debe incluir "active" booleano');
  });

  await check('GET /api/entitlement rechaza sin secret (401)', async () => {
    const res = await fetch(`${BASE_URL}/api/entitlement?userKey=verify_iap_deploy_smoke_test`);
    assert(res.status === 401, `status esperado 401, recibido ${res.status}`);
  });

  await check('POST /api/admin/reconcile-subscriptions responde 200 con secret válido', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/reconcile-subscriptions`, {
      method: 'POST',
      headers: { 'x-app-secret': SECRET },
    });
    assert(res.status === 200, `status esperado 200, recibido ${res.status}`);
    const body = await res.json();
    assert(body.ok === true, 'la respuesta debe incluir ok:true');
    console.log(`   ↳ total=${body.total} androidChecked=${body.androidChecked} iosChecked=${body.iosChecked} skippedIosNoServerApi=${body.skippedIosNoServerApi}`);
  });

  await check('POST /api/iap/apple-webhook rechaza payload sin firma válida (400)', async () => {
    const res = await fetch(`${BASE_URL}/api/iap/apple-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'not-a-real-jws' }),
    });
    assert(res.status === 400, `status esperado 400, recibido ${res.status}`);
  });

  await check('POST /api/iap/google-webhook rechaza sin token OIDC (401)', async () => {
    const res = await fetch(`${BASE_URL}/api/iap/google-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { data: Buffer.from('{}').toString('base64'), messageId: 'smoke-test' } }),
    });
    assert(res.status === 401, `status esperado 401, recibido ${res.status}`);
  });

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks OK`);
  if (failed.length) {
    console.error('❌ Algunos checks fallaron. Revisa el despliegue antes de continuar.');
    process.exitCode = 1;
  } else {
    console.log('🎉 Despliegue de IAP verificado correctamente.');
  }
}

main();
