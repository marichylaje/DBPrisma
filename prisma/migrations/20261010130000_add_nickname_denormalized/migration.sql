-- Agrega una columna "nickname" desnormalizada (solo lectura rápida para inspección manual)
-- a las tablas que referencian un usuario mediante userKey/userId. No elimina ni modifica
-- ninguna columna existente, y no borra datos.
--
-- La columna queda NULL para datos verdaderamente anónimos (sin User asociado), lo cual es
-- esperado: userKey/userId siguen siendo la fuente de verdad para identificar al usuario;
-- "nickname" es solo una copia de lectura para humanos.

ALTER TABLE "AnalyticsEvent" ADD COLUMN "nickname" TEXT;
ALTER TABLE "UserEntitlement" ADD COLUMN "nickname" TEXT;
ALTER TABLE "ProcessedIapNotification" ADD COLUMN "nickname" TEXT;
ALTER TABLE "UserDeck" ADD COLUMN "nickname" TEXT;
ALTER TABLE "SharedDeck" ADD COLUMN "nickname" TEXT;
ALTER TABLE "UserCollection" ADD COLUMN "nickname" TEXT;

-- Backfill: tablas que ya tienen relación real a User vía userId.
UPDATE "UserDeck" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userId" = u."id";

UPDATE "UserCollection" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userId" = u."id";

-- Backfill best-effort: tablas sin relación formal a User, pero donde "userKey" puede
-- coincidir con un User.id real (p. ej. cuando el cliente ya usa el id del usuario logueado
-- como userKey). Si no hay coincidencia, la fila simplemente queda con nickname = NULL.
UPDATE "UserEntitlement" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userKey" = u."id";

UPDATE "ProcessedIapNotification" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userKey" = u."id";

UPDATE "SharedDeck" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userKey" = u."id";

UPDATE "AnalyticsEvent" t
SET "nickname" = u."nickname"
FROM "User" u
WHERE t."userKey" = u."id";
