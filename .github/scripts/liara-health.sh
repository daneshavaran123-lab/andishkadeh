#!/usr/bin/env bash
# Polls https://<app>.liara.run/api/v1/health for up to five minutes (CI, after a deploy or on its own).
# Passes on 200. Fails at once with the server's own reason when the start-up failure page answers
# (503 with step and reason, apps/server/scripts/startup-failed.mjs).
set -u
app=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z' | tr -d '[:space:]')
case "$app" in
  '' | *[!a-z0-9-]*) echo "::error::LIARA_APP must be the app id as in the Liara console address (e.g. andishkadeh)"; exit 1 ;;
esac
url="https://$app.liara.run/api/v1/health"
code=""
for _ in $(seq 1 60); do
  out=$(curl -s -m 10 -w '\n%{http_code}' "$url" || true)
  code=$(printf '%s' "$out" | tail -n1)
  body=$(printf '%s' "$out" | sed '$d')
  if [ "$code" = "200" ]; then echo "$body"; exit 0; fi
  if [ "$code" = "503" ] && printf '%s' "$body" | grep -q '"step"'; then
    echo "::error::The server did not start: $body"
    exit 1
  fi
  sleep 5
done
echo "::error::No healthy answer from $url within 5 minutes (last HTTP status: ${code:-none}). See the app's logs in the Liara console."
exit 1
