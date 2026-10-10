-- Nueva tabla "AllDecks": mazos compartidos automáticamente (97-103 cartas) de todos los
-- usuarios, separada de "UserDeck" (mazos exportados/respaldados activamente).

CREATE TABLE "AllDecks" (
    "id" TEXT NOT NULL,
    "nickname" TEXT,
    "userKey" TEXT NOT NULL,
    "userId" TEXT,
    "deckName" TEXT NOT NULL,
    "deckDescription" TEXT,
    "instagram" TEXT,
    "commanderName" TEXT NOT NULL,
    "commanderId" TEXT,
    "partnerName" TEXT,
    "partnerId" TEXT,
    "cards" JSONB NOT NULL,
    "sideboard" JSONB NOT NULL DEFAULT '[]',
    "cardCount" INTEGER NOT NULL,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllDecks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllDecks_userKey_deckName_key" ON "AllDecks"("userKey", "deckName");
CREATE INDEX "AllDecks_userKey_idx" ON "AllDecks"("userKey");
CREATE INDEX "AllDecks_userId_idx" ON "AllDecks"("userId");
CREATE INDEX "AllDecks_cardCount_updatedAt_idx" ON "AllDecks"("cardCount", "updatedAt");

ALTER TABLE "AllDecks" ADD CONSTRAINT "AllDecks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
