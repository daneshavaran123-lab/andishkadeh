-- The public web app at / (WEB_APP_DEVICE_ID, packages/shared/src/kiosk-admin.ts). The server knows
-- it without a key and lets it read the catalogue only; the key hash is random and never used.
INSERT INTO "Device" ("id", "name", "apiKeyHash", "active", "updatedAt")
VALUES ('WEB-APP', 'وب‌اپ عمومی', md5(random()::text) || md5(random()::text), true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
