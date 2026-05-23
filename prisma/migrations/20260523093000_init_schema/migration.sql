-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."UserEntitlement" (
    "userKey" TEXT NOT NULL,
    "subActive" BOOLEAN NOT NULL DEFAULT false,
    "subPlatform" TEXT,
    "subProductId" TEXT,
    "subExpiry" TIMESTAMP(3),
    "pendingAndroid" BOOLEAN NOT NULL DEFAULT false,
    "androidPurchaseToken" TEXT,
    "lastVerifyAt" TIMESTAMP(3),
    "verifyError" TEXT,
    "trialGranted" BOOLEAN NOT NULL DEFAULT false,
    "trialStart" TIMESTAMP(3),
    "trialExpiry" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEntitlement_pkey" PRIMARY KEY ("userKey")
);

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

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "storeName" TEXT,
    "storeAddress" TEXT,
    "statsJson" JSONB,
    "badgesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tournament" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "powerLevel" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "entryFee" INTEGER NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "roomCode" TEXT,
    "bannerUrl" TEXT,
    "isPhysical" BOOLEAN NOT NULL DEFAULT true,
    "address" TEXT,
    "divisa" TEXT NOT NULL DEFAULT 'EUR',
    "allowProxies" BOOLEAN NOT NULL DEFAULT true,
    "proxyLimit" INTEGER NOT NULL DEFAULT 10,
    "requireDecklist" BOOLEAN NOT NULL DEFAULT true,
    "rulesEnforcement" TEXT NOT NULL DEFAULT 'Regular',
    "roundType" TEXT NOT NULL DEFAULT 'Swiss',
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "waitlist" JSONB,
    "admins" JSONB,
    "prizePool" TEXT,
    "prizeDetail" TEXT,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TournamentParticipant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deckSnapshot" JSONB,
    "roundsReport" TEXT[],
    "openToTrade" BOOLEAN NOT NULL DEFAULT false,
    "pointsProcessed" BOOLEAN NOT NULL DEFAULT false,
    "paymentStatus" TEXT NOT NULL DEFAULT 'Pending',
    "paymentMethod" TEXT,
    "decklistUrl" TEXT,
    "commanderScryfallId" TEXT,
    "decklistValidated" BOOLEAN NOT NULL DEFAULT false,
    "matchPoints" INTEGER NOT NULL DEFAULT 0,
    "omwPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "gwPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "finalPosition" INTEGER,
    "isDropped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JudgeReport" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "tableNumber" INTEGER,
    "playerId" TEXT NOT NULL,
    "infractionType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "privateNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "tableNumber" INTEGER NOT NULL,
    "players" JSONB NOT NULL,
    "results" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

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
    "cardKey" TEXT NOT NULL,
    "history" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPriceHistory_pkey" PRIMARY KEY ("cardKey")
);

-- CreateIndex
CREATE INDEX "UserDeck_userKey_idx" ON "public"."UserDeck"("userKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserDeck_userKey_deckName_key" ON "public"."UserDeck"("userKey", "deckName");

-- CreateIndex
CREATE INDEX "SharedDeck_createdAt_idx" ON "public"."SharedDeck"("createdAt");

-- CreateIndex
CREATE INDEX "SharedDeck_tournamentId_idx" ON "public"."SharedDeck"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_roomCode_key" ON "public"."Tournament"("roomCode");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_userId_key" ON "public"."TournamentParticipant"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_round_tableNumber_key" ON "public"."TournamentMatch"("tournamentId", "round", "tableNumber");

-- AddForeignKey
ALTER TABLE "public"."TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "public"."Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JudgeReport" ADD CONSTRAINT "JudgeReport_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "public"."Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JudgeReport" ADD CONSTRAINT "JudgeReport_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JudgeReport" ADD CONSTRAINT "JudgeReport_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "public"."Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

