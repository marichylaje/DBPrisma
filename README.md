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

### Verificacion de correo y recuperacion de contrasena

- `POST /api/auth-email-code` recibe `{ email, purpose: "register" | "reset", language? }`.
  Idiomas: `es`, `en`, `de`, `fr`, `it`, `ja`, `pt`; por defecto `en`.
  Devuelve siempre `{ ok: true, retryAfterSeconds: 60 }` para solicitudes procesadas,
  sin revelar si existe la cuenta. No envia correo de recuperacion a cuentas
  inexistentes ni de registro a correos ocupados. Errores de envio/configuracion
  se registran en el servidor y responden 500, nunca exito ficticio.
- `POST /api/auth-register` ahora exige un `code` de verificacion del correo,
  ademas de `username`, `email`, `password`. La cuenta solo se crea al verificarlo.
  `emailVerifiedAt` registra esa prueba; las cuentas existentes siguen pudiendo
  iniciar sesion sin verificar retroactivamente. Clientes antiguos no pueden
  registrar cuentas sin actualizarse: coordinar despliegue de backend y app.
- `POST /api/auth-reset-password` recibe `{ email, code, password }`. Solo cambia
  la contrasena de la cuenta vinculada al codigo; no inicia sesion automaticamente.
  Marca `emailVerifiedAt` en la misma transaccion y devuelve
  `{ ok: true, emailVerified: true }`.
  La nueva contrasena conserva la regla existente: entre 8 y 128 caracteres.
  Tambien acepta `{ action: "verify", email, code }` para el paso previo:
  devuelve `{ ok: true, codeVerified: true }` sin cambiar la cuenta ni consumir
  el codigo. Conserva los limites de intentos/caducidad. El guardado manual
  posterior vuelve a validar y consume el codigo atomicamente. No requiere
  migraciones adicionales; desplegar backend antes que el nuevo frontend.
- Login devuelve `emailVerified` tanto en la raiz como en `user`, derivado de
  `User.emailVerifiedAt`. No hace falta otra columna booleana ni otra migracion.
  Login no bloquea cuentas historicas cuyo correo aun no esta verificado.
- `POST /api/auth-verify-email` exige JWT de usuario (`kind: user`).
  `{ action: "send", language? }` envia un codigo solo al correo de la cuenta
  autenticada y devuelve `{ ok: true, emailVerified: false, retryAfterSeconds: 60 }`.
  `{ action: "confirm", code }` verifica y marca esa misma cuenta, sin cambiar su
  contrasena ni su JWT, devolviendo `{ ok: true, emailVerified: true }`.
  Si ya esta verificada, responde ese estado sin enviar otro email.
  No acepta un correo/ID de destino del cliente; codigos de registro, recuperacion
  y verificacion estan separados por proposito y vinculados a su propietario.
- Codigos de 6 digitos en todos los flujos, caducidad de 10 minutos, maximo 5 intentos fallidos,
  uso unico y espera de 60 segundos entre envios por correo/proposito.
  Maximo 5 solicitudes de envio por correo y hora, compartido entre IPs y
  propositos; ademas se aplican limites por IP. El correo del limitador se
  representa mediante SHA-256, no en claro.
  Se guardan HMAC, no codigos en claro. Reenvios reemplazan el codigo anterior.
  Verificar/consumir y crear/cambiar la cuenta son una transaccion atomica;
  locks de PostgreSQL impiden reutilizacion concurrente.
- Los JWT ya emitidos conservan su vigencia actual (7 dias). El cambio de
  contrasena **no revoca sesiones existentes**; revocacion por dispositivo/version
  de sesion requiere una siguiente fase en la capa de autenticacion.

#### Configuracion y despliegue

1. Configurar `RESEND_API_KEY`, `AUTH_EMAIL_FROM` (por ejemplo
   `MTG DeckBuilder <accounts@tu-dominio.com>`) y `AUTH_EMAIL_CODE_SECRET`
   (secreto aleatorio de al menos 32 caracteres) en Vercel, nunca en la app.
2. Verificar el dominio remitente en Resend y sus registros SPF/DKIM; configurar
   DMARC y probar entrega/spam con cuentas reales.
3. Aplicar `npm run migrate` para `20261112185000_add_auth_email_challenges`,
   ejecutar `npx prisma generate` y desplegar backend y app coordinadamente.
   La migracion no altera contrasenas ni verifica cuentas historicas.
   Si ya se aplico, no se necesita una migracion adicional para la invitacion de
   verificacion. Los codigos antiguos de 8 digitos deben reenviarse tras actualizar.
4. Probar en staging registro y recuperacion completos, correo inexistente,
   reenvio, codigo incorrecto/expirado/usado y fallo del proveedor.
5. El cron existente `/api/admin/cleanup` elimina los desafios caducados.
   Actualizar la politica de privacidad por el
   envio de emails transaccionales a traves de Resend.

### Trial por cuenta y dispositivo

- `UniqueDevice` registra el hash SHA-256 del identificador app-scoped de Android/iOS
  (namespaced por plataforma). No se almacena el identificador recibido en claro.
  `UniqueDeviceUser` vincula múltiples cuentas y dispositivos; no se usa email/nickname
  como identidad ni IMEI/MAC/identificadores publicitarios.
- `POST /api/auth-device` admite `{ platform, deviceIdentity, previousToken? }`.
  Vincula la sesión a `UniqueDevice.id`, incluido como `deviceId` en el JWT.
  `previousToken` conserva el propietario anónimo durante la actualización y adopta
  su trial existente. Repetir un identificador sin un token previo válido **nunca**
  recupera los datos de otra sesión anónima: solo encuentra el registro anti-abuso.
- Las llamadas a entitlement/trial llevan `Authorization` del dueño y
  `X-Device-Token` como prueba firmada de la vinculación. El servidor ignora los
  `userKey`/device IDs del body/query para determinar propietarios.
- Solo hay una ventana por dispositivo y una por cuenta. Cuentas nuevas en el mismo
  móvil heredan el mismo trial, incluso si expiró; una cuenta usada en un móvil nuevo
  tampoco inicia otro. Si ambos tienen trials distintos, la expiración efectiva es
  la menor. Las suscripciones nunca se heredan ni se limitan por esta regla.
- `UniqueDevice.trialOwnerKey` apunta al `UserEntitlement` original.
  Las cuentas que lo comparten guardan `sharedTrialKey` apuntando al mismo original.
  La fecha autoritativa sigue siendo `UserEntitlement.trialExpiry` del original:
  una edición allí se refleja en todas sus cuentas/dispositivos en el siguiente
  refresco. Para ampliar testers en conjunto, `npm run extend-trial` actualiza
  únicamente originales, no copias. Un segundo trial independiente puede seguir
  limitando una cuenta usada en otro dispositivo.
- La concesión/vinculación usa transacciones `Serializable` con reintentos acotados
  ante conflictos: dos registros simultáneos no reinician la ventana.
- `entitlement` añade `trialExpiryMs`; `trial/status` añade `canStartTrial`.
  Ambos, y `trial/start`, responden con `Cache-Control: no-store`.
  Nuevos trials sin identidad móvil vinculada devuelven `428 mobile_device_required`.
  Web/apps antiguas conservan lecturas de trials y suscripciones existentes.
- Borrar una cuenta elimina sus vínculos con `User`, pero conserva el registro
  pseudónimo del dispositivo y el trial consumido. La purga administrativa también
  conserva trials y elimina su nickname para no reabrir pruebas ni romper trials
  compartidos. Revisar y documentar fundamento/retención en la política de privacidad.

#### Despliegue y límites

1. Revisar copia de seguridad y aplicar la migración
   `20261109140000_add_device_trials` con `npm run migrate`; no reinicia ni modifica
   fechas históricas. Luego ejecutar `npx prisma generate` y desplegar backend.
2. Distribuir la app actualizada. En el primer uso adopta trials históricos:
   los antiguos datos no contienen identidad hardware, por lo que no es posible
   reconstruir retrospectivamente qué cuentas usaban el mismo móvil.
3. Comprobar en staging dos cuentas en un móvil, la misma cuenta en otro móvil,
   una ampliación del trial original y login/logout con trial expirado.
4. Antes de publicar, actualizar privacidad y declaraciones Data Safety/App Privacy
   por la recogida del identificador y revisar consentimiento/políticas de tiendas.

Esto limita el abuso de cuentas nuevas en clientes normales, no demuestra hardware.
Un cliente manipulado puede declarar otro identificador; un reset de fábrica, cambio
de usuario/clave de firma Android o ciertas restauraciones iOS pueden cambiarlo.
Para resistencia adicional, siguiente fase: challenge/nonce del servidor, Play
Integrity en Android y App Attest en iOS, verificados en backend y vinculados a sesión
y concesión; valorar DeviceCheck para la memoria anti-abuso en iOS. No aceptar un
booleano de "integridad" enviado por la app ni activar enforcement hasta validar
atestación real y compatibilidad de testers/dispositivos.

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

### Versiones mínimas de la app
- `MIN_REQUIRED_VERSION_IOS` y `MIN_REQUIRED_VERSION_ANDROID` definen por separado
  la versión mínima obligatoria informada por `GET /api/app-config`.
- Si una variable está vacía o no está configurada, el endpoint usa `LATEST_VERSION`
  como valor de respaldo. `latestVersion`, `minRequiredVersion` e
  `isUpdateRequired` se mantienen para compatibilidad con versiones antiguas de la app.

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
- Públicos (con rate limit): `auth-register`, `auth-login`, `auth-device`, `alldecks/list` (`?view=summary&limit=&cursor=` paginado y sin cartas), `alldecks/get` (cartas de un deck), `share/get`, `prices/history`, `tournaments/search`, `decks/downloads/batch`, `analytics/track`.
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
- El refresco de precios procesa solo impresiones presentes en colecciones y omite las ya actualizadas ese día UTC. Scryfall se consulta en lotes de hasta 75 cartas.
- Se conservan hasta 30 muestras por carta. Los historiales de cartas ausentes de todas las colecciones se eliminan cuando su última actualización de precio supera los 90 días; las cartas activas se conservan.
- Revisar el tamaño de `CardPriceHistory`, duración del cron y métricas de almacenamiento al superar 5.000 filas; no es un límite técnico, sino un punto de revisión preventiva.

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
- los scripts que creaban usuarios de prueba en la DB (`test_user_profile.js`, `test_tournament_platform.js`) fueron eliminados: la DB del `.env` es producción.

## Eliminar un usuario y sus datos

Edita la constante `USER_KEY` en `scripts/delete-user.js` y ejecuta:

```bash
node scripts/delete-user.js --dry-run   # solo muestra qué se borraría (no modifica nada)
node scripts/delete-user.js             # pide confirmación y borra en una transacción
```

Borra el `User` y todo lo asociado (mazos, colección, wishlist, amistades, friend nights, torneos, analítica, IAP, descargas). La lógica vive en `lib/purgeUser.js`. Opera sobre la DB del `.env` (producción).

## Extender el trial a todos los usuarios

Cambia `TRIAL_EXPIRY_DATE` (formato `dd-MM-yyyy`) en `scripts/extend-trial.js` y ejecuta:

```bash
node scripts/extend-trial.js --dry-run   # solo muestra cuántos usuarios se actualizarían
node scripts/extend-trial.js             # pide confirmación y actualiza UserEntitlement.trialExpiry
```

Solo toca filas con `trialGranted = true` y `trialExpiry` anterior a la nueva fecha (nunca acorta). Opera sobre la DB del `.env` (producción).

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
