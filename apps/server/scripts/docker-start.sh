#!/bin/sh
# Container start (Dockerfile): apply new migrations, run the idempotent seed (first install, and
# catalogue entries added by a new release; SEED_ON_START=0 skips it), then start the API.
set -e
cd /app/apps/server
./node_modules/.bin/prisma migrate deploy
if [ "${SEED_ON_START:-1}" = "1" ]; then
  ./node_modules/.bin/tsx prisma/seed.ts
fi
exec node dist/main.js
