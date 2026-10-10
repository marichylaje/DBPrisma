# Checklist de despliegue a producción — Gestión de Usuarios de Pago (IAP)

Checklist para dejar operativo el ciclo de vida completo de suscripciones (Apple + Google)
implementado en los Calls 1 y 2. Márcalo según avances.

## 1. Variables de entorno (Vercel > Project Settings > Environment Variables)

Ya confirmadas en producción (Call 1):
- [x] `APP_BACKEND_SECRET`
- [x] `APPLE_SHARED_SECRET`
- [x] `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- [x] `GOOGLE_PACKAGE_NAME`
Base de datos

- [x] Ejecutar la consulta de duplicados antes de migrar (ver comentario en el archivo de migración):
  ```sql
  SELECT "androidPurchaseToken", COUNT(*) FROM "UserEntitlement"
  WHERE "androidPurchaseToken" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
  ```
- [x] Aplicar la migración `20260914120000_add_iap_webhook_support` (`npx prisma migrate deploy`)
- [x] Confirmar `npx prisma generate` corrido tras el deploy (ya hecho en local; Vercel lo corre en `vercel-build`)


Pendientes para el ciclo de vida en tiempo real (Call 2):
- [X] `APPLE_ROOT_CA_BASE64` — certificados raíz de Apple en base64 (uno o más, separados por coma). Descargar desde https://www.apple.com/certificateauthority/
- [X] `APPLE_BUNDLE_ID` — bundle id de la app iOS
- [X] `APPLE_APP_APPLE_ID` — App ID numérico de App Store Connect (requerido si `APPLE_ENVIRONMENT=PRODUCTION`)
- [X] `APPLE_ENVIRONMENT` — `PRODUCTION` o `SANDBOX`
- [X] `GOOGLE_PUBSUB_AUDIENCE` — URL pública del webhook de Google (`https://<dominio>/api/iap/google-webhook`)
- [X] `GOOGLE_PUBSUB_INVOKER_SA` — (opcional, recomendado) email de la cuenta de servicio que Pub/Sub usa para firmar el push token

Opcionales (solo si se activa reconciliación pull para iOS):
- [X] `APPLE_ISSUER_ID`
- [X] `APPLE_KEY_ID`
- [X] `APPLE_IAP_PRIVATE_KEY_BASE64` — clave `.p8` de App Store Connect > Users and Access > Integrations > In-App Purchase, en base64

Opcional (cron):
- [X] `CRON_SECRET` — si quieres que Vercel Cron se autentique automáticamente contra `/api/admin/reconcile-subscriptions`

## 2. Configuración en App Store Connect

- [ ] Registrar la URL del webhook: Users and Access > Integrations > App Store Server Notifications V2 → `https://db-prisma-rho.vercel.app/api/iap/apple-webhook`
- [ ] (Opcional) Generar la clave de la App Store Server API para reconciliación pull

## 3. Configuración en Google Play Console / Google Cloud

- [X] Crear un topic de Pub/Sub y vincularlo en Play Console > Monetización > Notificaciones en tiempo real
- [X] Crear una suscripción push apuntando a `https://db-prisma-rho.vercel.app/api/iap/google-webhook`, con autenticación (cuenta de servicio) habilitada
- [X] Verificar que la cuenta de servicio de la suscripción coincide con `GOOGLE_PUBSUB_INVOKER_SA` (si se configuró)

## 4. Cron de reconciliación

- [X] Confirmar que `vercel.json` tiene la entrada `crons` para `/api/admin/reconcile-subscriptions`
- [X] Revisar el plan de Vercel: Hobby limita a 1 ejecución/día; ajustar el `schedule` si aplica

## 5. Pruebas antes de salir a producción

- [X] `node test_iap_entitlement.js` (requiere migración ya aplicada) — valida mapeos de estado y las constraints anti-replay
- [ ] Enviar una notificación de prueba desde App Store Connect (`SendConsumptionInformation`/Test) y confirmar que llega a `/api/iap/apple-webhook`
- [X] Enviar un mensaje de prueba desde la consola de Pub/Sub y confirmar que `/api/iap/google-webhook` responde 200
- [X] Ejecutar `node verify_iap_deploy.js` contra el entorno de producción (ver sección siguiente)

## 6. Post-deploy

- [X] Correr `node verify_iap_deploy.js` apuntando a la URL de producción
- [X] Revisar logs de Vercel filtrando `"scope":"iap"` para confirmar que los eventos se registran correctamente
- [Y] Monitorear `skippedIosNoServerApi` en la respuesta de `/api/admin/reconcile-subscriptions` — si es igual al total de subs iOS activas, la App Store Server API no está configurada

## 7. Rate limiting / protección básica (WAF)

Capa de aplicación (ya implementada en código, requiere la migración de este PR):
- [X] Aplicar la migración `20261010120000_add_rate_limit_hit` (`npx prisma migrate deploy` + `npx prisma generate`)
- [ ] Confirmar que `/api/auth-login`, `/api/auth-register`, `/api/iap/verify`, `/api/trial/start` y `/api/share/create` responden `429` (ráfaga o sostenido) al superar sus límites por IP — ver tiers `burst`/`sustained` en cada archivo
- [ ] Confirmar que `/api/auth-login` responde `423 account_temporarily_locked` tras varios intentos de password incorrecta seguidos para el mismo username (bloqueo por patrón de abuso, independiente de la IP — ver `LOGIN_FAIL_LIMIT`/`LOGIN_FAIL_WINDOW_SECONDS` en `api/auth-login.js`)
- [ ] Si se agrega una región/CDN propia delante de Vercel, confirmar que reenvía `x-forwarded-for` correctamente (el limitador usa ese header para identificar la IP)

Capa de edge/WAF (recomendado, complementa lo anterior — bloquea antes de invocar la función, sin consumir DB):
- [X] Activar Vercel WAF Rate Limiting (Project > Firewall > Configure > + New Rule) para los paths sensibles de arriba. Disponible en todos los planes; Hobby permite 1 regla de rate limit / hasta 3 reglas custom en total, así que conviene agrupar varios paths sensibles en una sola regla ("Path is one of: ...").
- [ ] (Opcional, según presupuesto de abuso) Activar IP Blocking / Managed Rulesets de Vercel WAF para bloquear tráfico de bots conocidos.
- [ ] Revisar la sección "Firewall" del dashboard de Vercel tras el primer día en producción para ver tráfico bloqueado/real antes de endurecer límites.
