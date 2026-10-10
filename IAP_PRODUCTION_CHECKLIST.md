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

- [V] Registrar la URL del webhook: Users and Access > Integrations > App Store Server Notifications V2 → `https://db-prisma-rho.vercel.app/api/iap/apple-webhook`
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
- [ ] Enviar un mensaje de prueba desde la consola de Pub/Sub y confirmar que `/api/iap/google-webhook` responde 200
- [ ] Ejecutar `node verify_iap_deploy.js` contra el entorno de producción (ver sección siguiente)

## 6. Post-deploy

- [ ] Correr `node verify_iap_deploy.js` apuntando a la URL de producción
- [X] Revisar logs de Vercel filtrando `"scope":"iap"` para confirmar que los eventos se registran correctamente
- [ ] Monitorear `skippedIosNoServerApi` en la respuesta de `/api/admin/reconcile-subscriptions` — si es igual al total de subs iOS activas, la App Store Server API no está configurada
