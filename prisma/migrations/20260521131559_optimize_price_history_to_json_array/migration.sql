/*
  Warnings:

  - The primary key for the `CardPriceHistory` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `CardPriceHistory` table. All the data in the column will be lost.
  - You are about to drop the column `priceEur` on the `CardPriceHistory` table. All the data in the column will be lost.
  - You are about to drop the column `priceUsd` on the `CardPriceHistory` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `CardPriceHistory` table. All the data in the column will be lost.
  - Added the required column `history` to the `CardPriceHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `CardPriceHistory` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."CardPriceHistory_cardKey_idx";

-- DropIndex
DROP INDEX "public"."CardPriceHistory_timestamp_idx";

-- AlterTable
ALTER TABLE "public"."CardPriceHistory" DROP CONSTRAINT "CardPriceHistory_pkey",
DROP COLUMN "id",
DROP COLUMN "priceEur",
DROP COLUMN "priceUsd",
DROP COLUMN "timestamp",
ADD COLUMN     "history" JSONB NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD CONSTRAINT "CardPriceHistory_pkey" PRIMARY KEY ("cardKey");
