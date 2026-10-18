#!/usr/bin/env bash
# The server's runtime packages for the Docker image, installed here and written to
# .liara/runtime.tgz. Liara's builder reaches npm slowly and its build time is capped (5 minutes on
# small plans), so the deploy job ships them with the upload and the image only unpacks them:
#   liara deploy ... --build-arg RUNTIME=.liara/runtime.tgz
# Without the build argument the image installs them itself (slower). Linux x64 only, the image's
# platform: the packages include native binaries (Prisma engines, esbuild).
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "runtime-bundle.sh runs on Linux x64 only (the image's platform)." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$work/"
for p in packages/shared apps/server apps/admin apps/kiosk e2e; do
  mkdir -p "$work/$p" && cp "$p/package.json" "$work/$p/"
done
mkdir -p "$work/apps/server/prisma" && cp apps/server/prisma/schema.prisma "$work/apps/server/prisma/"
(cd "$work" && pnpm install --frozen-lockfile --prod --filter "@andishkadeh/server..." --reporter=append-only)

# Prisma's WebAssembly engines for every database: the server uses the Node engine with PostgreSQL.
rm -f "$work"/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime/*.wasm-base64.*

mkdir -p .liara
tar -C "$work" -czf .liara/runtime.tgz node_modules apps/server/node_modules packages/shared/node_modules
echo "Runtime packages: .liara/runtime.tgz ($(du -h .liara/runtime.tgz | cut -f1))"
