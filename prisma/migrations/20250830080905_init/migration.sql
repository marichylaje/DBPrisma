-- CreateTable
CREATE TABLE "public"."UserEntitlement" (
    "userKey" TEXT NOT NULL,
    "trialGranted" BOOLEAN NOT NULL DEFAULT false,
    "trialStart" TIMESTAMP(3),
    "trialExpiry" TIMESTAMP(3),
    "subActive" BOOLEAN NOT NULL DEFAULT false,
    "subPlatform" TEXT,
    "subProductId" TEXT,
    "subExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("userKey")
);

-- CreateIndex
CREATE INDEX "UserEntitlement_subActive_subExpiry_idx" ON "public"."UserEntitlement"("subActive", "subExpiry");
