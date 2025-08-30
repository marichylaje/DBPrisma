-- DropIndex
DROP INDEX "public"."UserEntitlement_subActive_subExpiry_idx";

-- AlterTable
ALTER TABLE "public"."UserEntitlement" ADD COLUMN     "androidPurchaseToken" TEXT,
ADD COLUMN     "lastVerifyAt" TIMESTAMP(3),
ADD COLUMN     "pendingAndroid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verifyError" TEXT;
