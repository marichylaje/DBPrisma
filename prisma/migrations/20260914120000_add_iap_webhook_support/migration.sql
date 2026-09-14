-- Add real-time subscription lifecycle status + anti-replay/idempotency support

-- UserEntitlement: new fields
ALTER TABLE "UserEntitlement" ADD COLUMN "subStatus" TEXT;
ALTER TABLE "UserEntitlement" ADD COLUMN "appleOriginalTransactionId" TEXT;

-- Anti-replay: a purchase token / original transaction id must map to exactly one userKey.
-- NOTE: if any existing rows already share a duplicate non-null androidPurchaseToken,
-- this migration will fail. Run this check before applying in production:
--   SELECT "androidPurchaseToken", COUNT(*) FROM "UserEntitlement"
--   WHERE "androidPurchaseToken" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX "UserEntitlement_appleOriginalTransactionId_key" ON "UserEntitlement"("appleOriginalTransactionId");
CREATE UNIQUE INDEX "UserEntitlement_androidPurchaseToken_key" ON "UserEntitlement"("androidPurchaseToken");

-- Idempotency ledger for store webhooks (Apple notificationUUID / Google Pub/Sub messageId)
CREATE TABLE "ProcessedIapNotification" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "notificationType" TEXT,
    "userKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedIapNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessedIapNotification_notificationId_key" ON "ProcessedIapNotification"("notificationId");
CREATE INDEX "ProcessedIapNotification_source_createdAt_idx" ON "ProcessedIapNotification"("source", "createdAt");
