# Central server, admin panel and customer web app in one image (Liara, see docs/liara-deploy.md, or
# any Docker host). Start-up: database migrations, idempotent seed, then on $PORT: the web app at /,
# the panel at /admin, kiosk management at /kiosk and the API at /api/v1.
#
# The two browser builds are made before `docker build` and copied in, which keeps the build inside
# Liara's build-time limit and the image free of front-end tooling:
#   pnpm install && pnpm build:shared
#   pnpm --filter @andishkadeh/kiosk build:web     # apps/kiosk/dist-web (customer web app)
#   pnpm --filter @andishkadeh/admin build         # apps/admin/dist (panel and /kiosk)
# The deploy job and the image test in .github/workflows/apps.yml do exactly this.
FROM node:22-bookworm-slim

# Prisma needs OpenSSL; the slim image does not ship it.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dependencies first (cached while only source changes). Only the server is installed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/admin/package.json apps/admin/
COPY apps/kiosk/package.json apps/kiosk/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@andishkadeh/server..."

COPY . .
# A Windows working copy (git's default there is CRLF, and `liara deploy` uploads it as it is) has a
# CRLF start script, which sh stops at on its first line: strip the CRs so the image starts anyway.
RUN sed -i 's/\r$//' apps/server/scripts/docker-start.sh
RUN for f in apps/kiosk/dist-web/index.html apps/admin/dist/index.html; do \
      [ -f "$f" ] || { echo "Missing $f: build the web app and the panel before docker build (see the top of this Dockerfile)." >&2; exit 1; }; \
    done
RUN pnpm --filter @andishkadeh/shared build && pnpm --filter @andishkadeh/server build

ENV NODE_ENV=production \
    PORT=3001 \
    TRUST_PROXY=1 \
    ADMIN_DIST_DIR=/app/apps/admin/dist \
    WEB_APP_DIST_DIR=/app/apps/kiosk/dist-web \
    MEDIA_DIR=/app/storage/media
EXPOSE 3001
CMD ["sh", "apps/server/scripts/docker-start.sh"]
