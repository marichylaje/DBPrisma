-- Dedicated table for user-published cloud decks (MyDecks Export -> DeckBuilder)
CREATE TABLE "CloudDecks" (
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
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CloudDecks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CloudDecks_userKey_deckName_key" ON "CloudDecks"("userKey", "deckName");
CREATE INDEX "CloudDecks_userKey_idx" ON "CloudDecks"("userKey");
CREATE INDEX "CloudDecks_userId_idx" ON "CloudDecks"("userId");
CREATE INDEX "CloudDecks_updatedAt_idx" ON "CloudDecks"("updatedAt");

ALTER TABLE "CloudDecks"
ADD CONSTRAINT "CloudDecks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
