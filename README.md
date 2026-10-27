# DBPrisma Backend API

Backend serverless para una app mobile de Commander/MTG con:
- perfil de usuario y autenticación básica
- gestión de mazos, colecciones y compartición por QR
- torneos, rondas Swiss, reportes e insignias/gamificación
- sistema social (amigos + Friend Nights)
- suscripciones IAP (Apple + Google) con webhooks en tiempo real
- analítica de eventos y utilidades operativas

## Stack técnico

- Runtime: Node.js 18+ (CommonJS)
- API: Vercel Functions (carpeta `api/`)
- DB/ORM: PostgreSQL + Prisma
- Realtime adicional: Socket.IO (`socket-server.js`) para contador de vidas
- Integraciones externas:
  - Apple App Store (`@apple/app-store-server-library` + verifyReceipt)
  - Google Play Billing (`googleapis` subscriptionsv2)
  - Google Pub/Sub push auth (`google-auth-library`)
  - Scryfall API (histórico de precios)

## Arquitectura

### Capa API
Cada archivo dentro de `api/` es un endpoint serverless independiente.

Patrón común:
1. `applyCors` + `handleCorsPreflight`
2. validación de método HTTP
3. autenticación por JWT (`requireOwner` para datos de usuario/dispositivo, `requireUser` para cuentas) o secreto de servidor (`checkAdminSecret`, solo `/api/admin/*`). Los webhooks externos se autentican criptográficamente.
4. validación de entrada (`lib/validate.js`, zod) y rate limit (`lib/rateLimit.js`)
5. lógica de negocio con Prisma. Los errores 500 se responden con `lib/httpError.js` (sin detalles internos)

### Modelo de identidad
- **Cuenta** (`kind: user`): `POST /api/auth-register` / `auth-login` emiten un JWT con `sub = User.id`.
- **Dispositivo anónimo** (`kind: device`): `POST /api/auth-device` emite un JWT con un `userKey` generado por el servidor (`dev_<hex>`).
- El dueño de los datos (`userKey`) sale **siempre del token**, nunca del body/query. Un token de dispositivo no sirve en rutas de cuenta.
- Al iniciar sesión, `POST /api/auth-sync/migrate-user-data` traslada los datos anónimos a la cuenta usando el token de dispositivo como prueba de propiedad.

### Capa de negocio
`lib/` concentra piezas compartidas:
- `auth.js`: emisión/verificación de JWT (HS256, `iss`/`aud`) y `checkAdminSecret`
- `validate.js`: esquemas zod y límites de tamaño
- `password.js`: hash scrypt asíncrono
- `httpError.js`: respuestas 500 genéricas
- `cors.js`: reglas CORS
- `prisma.js`: inicializa PrismaClient
- módulos de IAP Apple/Google
- `playerGamification.js`: snapshot de estadísticas e insignias
- `deckDownloads.js`: normalización de claves de descargas

### Capa de datos
Modelo Prisma en `prisma/schema.prisma`.
Dominios principales:
- usuarios
- mazos y colecciones
- torneos y partidas
- social (amistades y friend nights)
- suscripciones IAP e idempotencia de notificaciones
- analítica

## Variables de entorno

### Requeridas base
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `APP_JWT_SECRET` (≥ 32 caracteres aleatorios; el backend se niega a firmar con una clave más corta)
- `ADMIN_SECRET` (solo server-to-server: `/api/admin/*`, GitHub Actions. **Nunca en la app**)

### CORS (DONE)
- `APP_ALLOWED_ORIGINS` (lista separada por comas, ej: `https://app.midominio.com,https://admin.midominio.com`)

### IAP Apple
- `APPLE_SHARED_SECRET`
- `APPLE_ROOT_CA_BASE64`
- `APPLE_BUNDLE_ID`
- `APPLE_ENVIRONMENT` (`PRODUCTION` o `SANDBOX`)
- `APPLE_APP_APPLE_ID` (obligatorio si `PRODUCTION`)

Opcionales para reconciliación pull:
- `APPLE_ISSUER_ID`
- `APPLE_KEY_ID`
- `APPLE_IAP_PRIVATE_KEY_BASE64`

### IAP Google
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- `GOOGLE_PACKAGE_NAME`
- `GOOGLE_PUBSUB_AUDIENCE`
- `GOOGLE_PUBSUB_INVOKER_SA` (recomendado)

### Operación
- `CRON_SECRET` (para invocación de cron por Authorization Bearer)
- `TRIAL_DAYS` (default interno: 15)
- `ALLOW_PENDING_ANDROID_PREMIUM` (feature flag)
- `DISABLE_ANDROID_VERIFY` (feature flag, ⚠️ **peligrosa**: desactiva la verificación real de compras Android contra Google Play y concede acceso "pendiente" solo confiando en lo que envía el cliente. Pensada como bypass temporal mientras no se tenga acceso a la API de Google Play; cada uso queda auditado con `logIapEvent` (evento `verify_bypassed_unverified_grant`, incluye si corrió en producción). Debe desactivarse (`false`) en cuanto la verificación real esté disponible)
- `PENDING_DEFAULT_DAYS` (días de acceso "pendiente" otorgados mientras `DISABLE_ANDROID_VERIFY=true`; el backend lo acota a un máximo de 30 días sin importar el valor configurado)

### Tracking externo de eventos IAP
- `EVENT_TRACKING_API_URL`
- `EVENT_TRACKING_API_KEY`

## Instalación y ejecución local

```bash
npm install
npx prisma generate
npm run local
```

Otros comandos:
- `npm run migrate`
- `npm run studio`
- `npm run socket`

## Endpoints API

Autenticación:
- Endpoints de datos y de usuario exigen `Authorization: Bearer <JWT>` (sesión de cuenta o de dispositivo; ver "Modelo de identidad").
- Endpoints admin/internos (`/api/admin/*`) usan `x-app-secret: <ADMIN_SECRET>` o `Authorization: Bearer <CRON_SECRET>` (Vercel Cron).
- Públicos (con rate limit): `auth-register`, `auth-login`, `auth-device`, `alldecks/list`, `share/get`, `prices/history`, `tournaments/search`, `decks/downloads/batch`, `analytics/track`.
- Excepciones:
  - `/api/iap/apple-webhook` (firma criptográfica Apple)
  - `/api/iap/google-webhook` (OIDC token de Pub/Sub)

### Auth y perfil
- `POST /api/auth-device` (sesión anónima)
- `POST /api/auth-register`
- `POST /api/auth-login`
- `GET /api/user/get`
- `POST /api/user/save`
- `GET /api/user/dashboard`
- `GET /api/auth-sync/get-user-data`
- `POST /api/auth-sync/migrate-user-data`
- `POST /api/auth-delete` (JWT; borra la cuenta y sus datos, requerido por App Store 5.1.1(v))
### Entitlement, trial e IAP
- `GET /api/entitlement`
- `POST /api/trial/start`
- `GET /api/trial/status`
- `POST /api/iap/verify`
- `POST /api/iap/apple-webhook`
- `POST /api/iap/google-webhook`
- `POST|GET /api/admin/reconcile-subscriptions`
- `POST|GET /api/admin/reverify-pending`

Política de SKUs (allowlist estricta):
- Solo SKUs en catálogo conceden/actualizan entitlement premium.
- Cualquier `productId` Android fuera de catálogo se rechaza con `400 { error: "invalid_product_id" }`.
- En iOS, si Apple valida receipt pero el `productId` no pertenece al catálogo, el backend no concede premium (`active=false`) y registra warning de auditoría.
- Todas las tiers de soporte mapean al mismo entitlement funcional (`premium`), sin diferencias de permisos.

Matriz de product IDs soportados:

| Plataforma | Product IDs permitidos |
|---|---|
| iOS | `premium.support.5`, `premium.support.8`, `premium.support.12`, `premium.support.15`, `premium.support.20` |
| Android | `premium_support_5`, `premium_support_8`, `premium_support_12`, `premium_support_15`, `premium_support_20` |

### Mazos y colección
- `POST /api/decks/save`
- `POST|PATCH /api/decks/patch`
- `POST|DELETE /api/decks/delete`
- `GET /api/decks/get`
- `GET /api/decks/list`
- `POST /api/decks/download`
- `POST /api/decks/downloads/batch`
- `POST /api/collection/save`
- `GET /api/collection/get`

### Compartición
- `POST /api/share/create`
- `GET /api/share/get`

### Torneos y partidas
- `POST /api/tournaments/create`
- `GET /api/tournaments/search`
- `POST /api/tournaments/enroll`
- `PUT /api/tournaments/check-in`
- `POST /api/tournaments/generate-round`
- `GET /api/tournaments/active-match`
- `POST /api/matches/report`
- `POST /api/reports/create`
- `POST /api/tournaments/update-admins`
- `POST /api/tournaments/finalize`

### Social
- `GET /api/friends/search`
- `POST /api/friends/request`
- `POST /api/friends/respond`
- `POST /api/friends/remove`
- `GET /api/friends/list`

### Friend Nights
- `POST /api/friend-nights/create`
- `POST /api/friend-nights/join`
- `GET /api/friend-nights/get`
- `GET /api/friend-nights/list`
- `GET /api/friend-nights/invites`
- `POST /api/friend-nights/respond-invite`
- `PUT /api/friend-nights/update-player`

### Analítica y precios
- `POST /api/analytics/track`
- `GET /api/prices/history`
- `POST /api/admin/refresh-prices`

## Base de datos (resumen)

### Núcleo de usuario
- `User`
  - perfil (`nickname`, `email`, `role`)
  - progreso (`xp`, `level`)
  - snapshots (`statsJson`, `badgesJson`)

### Mazos y colección
- `UserDeck` (mazos privados por usuario; también los exportados activamente a "Decks de Usuario")
- `AllDecks` (modelo `AllDeck`; mazos de 97-103 cartas compartidos automáticamente, con `cardCount` indexado para filtrar en DB)
- `SharedDeck` (mazos compartidos con expiración reactiva)
- `UserCollection` (cartas por `userKey`)
- `DeckDownload` (contadores de descargas no-cloud)

### Torneos
- `Tournament`
- `TournamentParticipant`
- `TournamentMatch`
- `JudgeReport`

### Social
- `Friendship`
- `FriendNightEvent`
- `FriendNightPlayer`
- `FriendNightInvite`

### Suscripciones e IAP
- `UserEntitlement`
- `ProcessedIapNotification` (idempotencia webhooks)

### Analítica y precios
- `AnalyticsEvent`
- `CardPriceHistory`

## Realtime Socket (servicio separado)

Archivo: `socket-server.js`
- servidor Socket.IO con estado en memoria por sala
- creación/join de salas
- sincronización de estado de partida
- cleanup diferido de salas inactivas

Despliegue sugerido separado del API serverless (ya existe `fly.toml`).

## Deploy

### Vercel
- `vercel.json` define headers globales para `/api/*`
- cron configurado:
  - `/api/admin/reconcile-subscriptions`
  - cada 6 horas (`0 */6 * * *`)

### Prisma
- aplicar migraciones con:

```bash
npx prisma migrate deploy
npx prisma generate
```

## Scripts de verificación

- `node test_iap_entitlement.js`
- `node verify_iap_deploy.js`
- `node test_deck_downloads.js`

Notas:
- algunos scripts de prueba son integraciones directas y dependen de una DB real con esquema vigente.

## Checklist de salida a producción

Referencia principal: `IAP_PRODUCTION_CHECKLIST.md`.
## ALL CHECKED
Recomendado antes de publicar:
1. Confirmar variables de entorno en producción.
2. Ejecutar migraciones de Prisma y validar constraints únicas de IAP.
3. Probar webhooks Apple/Google en entorno real.
4. Ejecutar smoke test (`verify_iap_deploy.js`).
5. Revisar logs filtrando eventos IAP (`scope: iap`).

## Limitaciones conocidas

- Las sesiones son JWT sin refresh ni revocación: el token de cuenta dura 7 días y el de dispositivo 365 días. Si se compromete `APP_JWT_SECRET`, rotarlo invalida todas las sesiones.
- Rate limiting por IP en `lib/rateLimit.js` (contador en Postgres); las rutas sensibles de auth/registro/sesión fallan en modo cerrado. Recomendado complementar con reglas de Vercel WAF — ver `IAP_PRODUCTION_CHECKLIST.md`.
- Debes configurar `APP_ALLOWED_ORIGINS` explícitamente en producción.
- Tests de seguridad: `npm test` (stubs de Prisma, sin base de datos). Los scripts `test_*.js` de la raíz están desactualizados respecto al esquema actual y requieren una BD real.
- `DISABLE_ANDROID_VERIFY` se ignora en producción (`VERCEL_ENV=production`).

## Licencia

Pendiente de definir por el propietario del proyecto.
