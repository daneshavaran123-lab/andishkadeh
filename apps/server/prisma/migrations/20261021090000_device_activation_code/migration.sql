-- One-time activation code for connecting a kiosk (panel → kiosk setup): only its sha256 is kept,
-- with the time it stops working; cleared when the kiosk uses it.
ALTER TABLE "Device" ADD COLUMN "activationCodeHash" TEXT,
ADD COLUMN "activationExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Device_activationCodeHash_key" ON "Device"("activationCodeHash");
