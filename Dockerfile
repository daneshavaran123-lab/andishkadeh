# Central server + admin panel in one image (Liara, see docs/liara-deploy.md, or any Docker host).
# Start-up: database migrations, idempotent seed, then the API on $PORT with the panel at /admin.
FROM node:22-bookworm-slim

# Prisma needs OpenSSL; the slim image does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dependencies first (cached while only source changes). Only the server and the panel are installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/admin/package.json apps/admin/
COPY apps/kiosk/package.json apps/kiosk/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@andishkadeh/server..." --filter "@andishkadeh/admin..."

COPY . .
# The panel calls the API on its own origin (VITE_API_URL empty).
RUN pnpm --filter @andishkadeh/shared build \
 && pnpm --filter @andishkadeh/server build \
 && VITE_API_URL= pnpm --filter @andishkadeh/admin build

ENV NODE_ENV=production \
    PORT=3001 \
    TRUST_PROXY=1 \
    ADMIN_DIST_DIR=/app/apps/admin/dist \
    MEDIA_DIR=/app/storage/media
EXPOSE 3001
CMD ["sh", "apps/server/scripts/docker-start.sh"]
