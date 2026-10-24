-- Índices de rendimiento y soporte de búsqueda insensible a mayúsculas.

-- Requerido por el índice GIN trigram sobre User.nickname (Neon / Postgres lo soportan).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "User_nickname_idx" ON "User" USING GIN ("nickname" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Tournament_status_startDate_idx" ON "Tournament"("status", "startDate");

-- CreateIndex
CREATE INDEX "Tournament_latitude_longitude_idx" ON "Tournament"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Tournament_storeId_idx" ON "Tournament"("storeId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_userId_idx" ON "TournamentParticipant"("userId");

-- CreateIndex
CREATE INDEX "JudgeReport_tournamentId_idx" ON "JudgeReport"("tournamentId");

-- CreateIndex
CREATE INDEX "JudgeReport_playerId_idx" ON "JudgeReport"("playerId");

-- CreateIndex
CREATE INDEX "JudgeReport_judgeId_idx" ON "JudgeReport"("judgeId");

-- CreateIndex
CREATE INDEX "UserEntitlement_subActive_idx" ON "UserEntitlement"("subActive");

-- CreateIndex
CREATE INDEX "RateLimitHit_windowStart_idx" ON "RateLimitHit"("windowStart");
