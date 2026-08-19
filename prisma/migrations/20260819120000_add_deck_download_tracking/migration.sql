-- AlterTable
ALTER TABLE "public"."UserDeck"
ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."DeckDownload" (
    "deckKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeckDownload_pkey" PRIMARY KEY ("deckKey")
);
