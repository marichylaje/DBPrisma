-- CreateTable
CREATE TABLE "public"."UserDeck" (
    "id" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "deckName" TEXT NOT NULL,
    "deckDescription" TEXT,
    "instagram" TEXT,
    "commanderName" TEXT NOT NULL,
    "commanderId" TEXT,
    "partnerName" TEXT,
    "partnerId" TEXT,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDeck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDeck_userKey_idx" ON "public"."UserDeck"("userKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeck_userKey_deckName_key" ON "public"."UserDeck"("userKey", "deckName");
