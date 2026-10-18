#!/usr/bin/env bash
# Polls https://<app>.liara.run/api/v1/health for up to ten minutes (CI, after a deploy or on its own),
# then checks that /, /admin and /kiosk serve their parts of the site and that the public web app
# gets the catalogue. Fails at once with the server's own reason when the start-up failure page
# answers (503 with step and reason, apps/server/scripts/startup-failed.mjs).
# Usage: liara-health.sh <app> [version]. After a deploy, pass the deployed version: Liara keeps the
# previous container answering until the new one is up, so a healthy answer only counts once it
# reports that version.
set -u
app=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z' | tr -d '[:space:]')
want=${2:-}
case "$app" in
  '' | *[!a-z0-9-]*) echo "::error::LIARA_APP must be the app id as in the Liara console address (e.g. andishkadeh)"; exit 1 ;;
esac
url="https://$app.liara.run/api/v1/health"
code=""
body=""
live=""
for _ in $(seq 1 120); do
  out=$(curl -s -m 10 -w '\n%{http_code}' "$url" || true)
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d')
  if [ "$code" = "200" ]; then
    if [ -z "$want" ] || printf '%s' "$body" | grep -qF "\"version\":\"$want\""; then live=1; echo "$body"; break; fi
  fi
  if [ "$code" = "503" ] && printf '%s' "$body" | grep -q '"step"'; then
    echo "::error::The server did not start: $body"
    exit 1
  fi
  sleep 5
done
if [ -z "$live" ]; then
  if [ "$code" = "200" ]; then
    echo "::error::$url still answers with the previous release after 10 minutes ($body), not $want. The new container did not come up: see the app's logs in the Liara console."
  else
    echo "::error::No healthy answer from $url within 10 minutes (last HTTP status: ${code:-none}). See the app's logs in the Liara console."
  fi
  exit 1
fi

# The three parts of the site: customer web app at /, admin panel at /admin, kiosk management at
# /kiosk (the panel build). Told apart by their install manifests.
failed=0
route() {
  if curl -s -m 15 "https://$app.liara.run$1" | grep -qF "$2"; then
    echo "ok  $1  $3"
  else
    echo "::error::https://$app.liara.run$1 is not the $3"
    failed=1
  fi
}
route / './manifest.webmanifest' 'customer web app'
route /admin/login '/admin/manifest.webmanifest' 'admin panel'
route /kiosk '/admin/manifest.webmanifest' 'kiosk management page'
# The public web app at / reads the catalogue as device WEB-APP, without a key.
if curl -s -m 15 -H 'X-Device-Id: WEB-APP' "https://$app.liara.run/api/v1/kiosk/bootstrap" | grep -q '"categories"'; then
  echo "ok  /api/v1/kiosk/bootstrap  public web app catalogue"
else
  echo "::error::The public web app gets no catalogue (device WEB-APP missing or disabled?)"
  failed=1
fi
exit $failed
