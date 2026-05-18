-- CreateTable
CREATE TABLE "public"."SharedDeck" (
    "id" TEXT NOT NULL,
    "userKey" TEXT,
    "deckName" TEXT NOT NULL,
    "deckDescription" TEXT,
    "commanderName" TEXT NOT NULL,
    "commanderId" TEXT,
    "partnerName" TEXT,
    "partnerId" TEXT,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sharedType" TEXT NOT NULL DEFAULT 'QR',
    "tournamentId" TEXT,

    CONSTRAINT "SharedDeck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedDeck_createdAt_idx" ON "public"."SharedDeck"("createdAt");

-- CreateIndex
CREATE INDEX "SharedDeck_tournamentId_idx" ON "public"."SharedDeck"("tournamentId");
