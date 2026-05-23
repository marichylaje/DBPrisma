-- CreateTable
CREATE TABLE "public"."AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "screenName" TEXT,
    "flowName" TEXT,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "language" TEXT,
    "region" TEXT,
    "role" TEXT,
    "isPaidUser" BOOLEAN,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "properties" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "public"."AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "public"."AnalyticsEvent"("eventName", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userKey_occurredAt_idx" ON "public"."AnalyticsEvent"("userKey", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_idx" ON "public"."AnalyticsEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_screenName_occurredAt_idx" ON "public"."AnalyticsEvent"("screenName", "occurredAt");
