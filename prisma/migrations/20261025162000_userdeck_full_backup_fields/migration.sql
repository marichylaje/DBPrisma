-- Allow full user deck backups, including decks without commander,
-- and persist full serialized deck payload for lossless recovery.
ALTER TABLE "UserDeck"
ALTER COLUMN "commanderName" DROP NOT NULL;

ALTER TABLE "UserDeck"
ADD COLUMN "deckData" JSONB;
