-- CreateTable
CREATE TABLE "public"."UserCollection" (
    "userKey" TEXT NOT NULL,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCollection_pkey" PRIMARY KEY ("userKey")
);

-- CreateTable
CREATE TABLE "public"."CardPriceHistory" (
    "id" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION,
    "priceEur" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardPriceHistory_cardKey_idx" ON "public"."CardPriceHistory"("cardKey");

-- CreateIndex
CREATE INDEX "CardPriceHistory_timestamp_idx" ON "public"."CardPriceHistory"("timestamp");
