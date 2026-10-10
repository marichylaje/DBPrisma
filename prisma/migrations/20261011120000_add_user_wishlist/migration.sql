-- Wishlist sincronizada por usuario/dispositivo para poder compartirla con amigos.
CREATE TABLE "UserWishlist" (
    "userKey" TEXT NOT NULL,
    "nickname" TEXT,
    "userId" TEXT,
    "cards" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWishlist_pkey" PRIMARY KEY ("userKey")
);

CREATE INDEX "UserWishlist_userId_idx" ON "UserWishlist"("userId");

ALTER TABLE "UserWishlist" ADD CONSTRAINT "UserWishlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
