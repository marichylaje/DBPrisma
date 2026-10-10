-- Basic application-level rate limiting: shared fixed-window counter table.
-- Keyed by "<ruleName>:<ip>", updated via an atomic UPSERT from lib/rateLimit.js
-- so it works correctly across multiple serverless instances (no shared memory).

CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
);
