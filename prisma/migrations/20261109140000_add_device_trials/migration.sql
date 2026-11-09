ALTER TABLE "UserEntitlement" ADD COLUMN "sharedTrialKey" TEXT;

CREATE TABLE "UniqueDevice" (
    "id" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "trialOwnerKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UniqueDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UniqueDeviceUser" (
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UniqueDeviceUser_pkey" PRIMARY KEY ("deviceId", "userId")
);

CREATE UNIQUE INDEX "UniqueDevice_identityHash_key" ON "UniqueDevice"("identityHash");
CREATE INDEX "UniqueDevice_trialOwnerKey_idx" ON "UniqueDevice"("trialOwnerKey");
CREATE INDEX "UniqueDeviceUser_userId_idx" ON "UniqueDeviceUser"("userId");
CREATE INDEX "UserEntitlement_sharedTrialKey_idx" ON "UserEntitlement"("sharedTrialKey");

ALTER TABLE "UserEntitlement" ADD CONSTRAINT "UserEntitlement_sharedTrialKey_fkey"
    FOREIGN KEY ("sharedTrialKey") REFERENCES "UserEntitlement"("userKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniqueDevice" ADD CONSTRAINT "UniqueDevice_trialOwnerKey_fkey"
    FOREIGN KEY ("trialOwnerKey") REFERENCES "UserEntitlement"("userKey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniqueDeviceUser" ADD CONSTRAINT "UniqueDeviceUser_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "UniqueDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UniqueDeviceUser" ADD CONSTRAINT "UniqueDeviceUser_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
