-- AlterTable
ALTER TABLE "public"."SharedDeck" ADD COLUMN     "sideboard" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "public"."UserDeck" ADD COLUMN     "sideboard" JSONB NOT NULL DEFAULT '[]';
