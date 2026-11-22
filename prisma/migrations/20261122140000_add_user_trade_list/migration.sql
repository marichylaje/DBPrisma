-- Carpeta "Cartas para intercambiar" sincronizada por usuario/dispositivo para mostrarla a los amigos.
CREATE TABLE "UserTradeList" (
    "userKey" TEXT NOT NULL,
    "nickname" TEXT,
    "userId" TEXT,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTradeList_pkey" PRIMARY KEY ("userKey")
);

CREATE INDEX "UserTradeList_userId_idx" ON "UserTradeList"("userId");

ALTER TABLE "UserTradeList" ADD CONSTRAINT "UserTradeList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
