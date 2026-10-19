-- A photo per subscription plan, shown on the plan's card in the kiosk and replaceable in the panel.
ALTER TABLE "SubscriptionPlan" ADD COLUMN "mediaId" TEXT;

ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
