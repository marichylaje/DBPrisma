# APP_CHANGES (para admin IA de App/Frontend)

Este documento lista SOLO cambios que debe implementar la app/frontend por los hardenings recientes del backend.

## 1) JWT obligatorio en endpoints de usuario

### Cambios de contrato en login/register
- `POST /api/auth-login` ahora devuelve `token` (JWT) además de `user` y `userId`.
- `POST /api/auth-register` ahora devuelve `token` (JWT) además de `user` y `userId`.

### Acción en app
- Guardar `token` de forma segura tras login/register.
- Enviar header `Authorization: Bearer <token>` en los endpoints JWT.
- Manejar expiración/invalidación del token:
  - `401 { error: "missing_bearer_token" }`
  - `401 { error: "invalid_token" }`
  - En ambos casos: limpiar sesión local y forzar login.

## 2) Endpoints que AHORA requieren Bearer JWT

Aplicar `Authorization: Bearer <token>` en todas estas rutas:

### Perfil/usuario
- `GET /api/user/get`
- `POST /api/user/save`
- `GET /api/user/dashboard`
- `GET /api/auth-sync/get-user-data`
- `POST /api/auth-sync/migrate-user-data`

### Friends
- `GET /api/friends/list`
- `GET /api/friends/search`
- `POST /api/friends/request`
- `POST /api/friends/respond`
- `POST /api/friends/remove`

### Friend Nights
- `POST /api/friend-nights/create`
- `POST /api/friend-nights/join`
- `GET /api/friend-nights/get`
- `GET /api/friend-nights/list`
- `GET /api/friend-nights/invites`
- `POST /api/friend-nights/respond-invite`
- `PUT /api/friend-nights/update-player`

### Torneos y reportes
- `POST /api/tournaments/create`
- `POST /api/tournaments/update-admins`
- `POST /api/tournaments/enroll`
- `GET /api/tournaments/active-match`
- `PUT /api/tournaments/check-in`
- `POST /api/tournaments/generate-round`
- `POST /api/tournaments/finalize`
- `POST /api/matches/report`
- `POST /api/reports/create`

## 3) Validaciones de ownership/actor (impacto en payloads)

Para evitar `403 forbidden`, la app debe asegurar coherencia entre token y payload/query:

- En endpoints con `userId` en query/body:
  - `userId` DEBE ser el mismo usuario del token.
- `POST /api/friends/request`:
  - `requesterId` DEBE coincidir con el usuario del token.
- `POST /api/friends/respond` y `POST /api/friends/remove`:
  - `userId` DEBE coincidir con el usuario del token.
- `POST /api/friend-nights/create`:
  - `createdByUserId` DEBE coincidir con el usuario del token.
- `POST /api/friend-nights/join`, `get`, `list`, `invites`, `respond-invite`, `update-player`:
  - `userId` DEBE coincidir con el usuario del token.
- `POST /api/tournaments/create`:
  - `storeId` DEBE coincidir con el usuario del token.
- `POST /api/tournaments/update-admins`:
  - ya no mandar `userId`; backend toma identidad desde token.
- `POST /api/matches/report`:
  - `reportedBy` DEBE coincidir con el usuario del token.
- `POST /api/reports/create`:
  - `judgeId` DEBE coincidir con el usuario del token.

## 4) Control por rol (impacto UI/UX)

El backend ahora aplica rol por token en rutas sensibles:
- Rutas de organizer/store exigen rol `store`.
- Enroll exige rol `player`.

### Acción en app
- Ocultar o deshabilitar acciones de organizer para usuarios no-store.
- Mostrar mensaje claro cuando llegue `403 forbidden` por permisos/rol.

## 5) Endpoints que SIGUEN con x-app-secret

No migrados aún a JWT (mantener flujo actual de app para estas rutas):
- Decks (`/api/decks/*`)
- Collection (`/api/collection/*`)
- Share (`/api/share/*`)
- Entitlement/Trial (`/api/entitlement`, `/api/trial/*`)
- IAP verify (`/api/iap/verify`)
- Tournaments search (`/api/tournaments/search`)
- Prices history (`/api/prices/history`)
- Analytics track (`/api/analytics/track`)
- Admin internos (`/api/admin/*`)

## 6) CORS / Web frontend

Si existe frontend web (no solo app mobile), validar con backend que el dominio esté en allowlist de `APP_ALLOWED_ORIGINS`; si no, las llamadas browser serán bloqueadas por CORS.

## 7) Ajuste técnico recomendado en cliente

Implementar capa de API con estrategia por endpoint:
- Grupo JWT: inyectar `Authorization: Bearer`.
- Grupo legacy: mantener `x-app-secret`.
- En errores 401/403, mapear mensajes por tipo para mejorar UX.

## 8) `POST /api/user/save`: el rol ya NO se puede cambiar después de creada la cuenta

Antes, cualquier llamada a `POST /api/user/save` con `role` en el body sobrescribía el rol del usuario. Esto permitía que un jugador autenticado se auto-promoviera a `store` y desbloqueara funciones de organizador (crear/finalizar torneos, gestionar co-admins, emitir reportes de juez). Ya se corrigió en backend.

Comportamiento nuevo:
- **Primer `save` (cuenta nueva):** `role` enviado en el body SÍ se usa para crear la cuenta (`player` por defecto si no se envía).
- **`save` posteriores (cuenta ya existe):** el campo `role` del body se IGNORA silenciosamente; el rol queda fijo al que ya tiene el usuario en DB. `storeName`/`storeAddress` solo se actualizan si el usuario ya es `role: 'store'`.
- La respuesta sigue devolviendo `user.role` real (el de DB), así que la app debe confiar siempre en ese valor y no asumir que el `role` que mandó en el body fue aplicado.

### Acción en app
- No depender de poder "cambiar de rol" llamando a `user/save` después del registro inicial.
- Si se necesita un flujo de "convertir cuenta de jugador a tienda" (o viceversa), ese flujo de verificación/aprobación debe implementarse como una función nueva en backend (pendiente, aún no existe) — avisar si la app ya tiene UI que depende de este cambio de rol self-service.
