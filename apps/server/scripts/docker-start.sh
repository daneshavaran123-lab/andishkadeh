#!/bin/sh
# Container start (Dockerfile): check the settings, apply new migrations, run the idempotent seed
# (first install, and catalogue entries added by a new release; SEED_ON_START=0 skips it), then
# start the API. When a step fails, its output stays in the log and startup-failed.mjs answers on
# $PORT with the reason, instead of the platform's bare 502.
cd /app/apps/server || exit 1
LOG=/tmp/startup.log
: > "$LOG"

# Runs a step, printing its output to the container log and keeping a copy for the failure page.
step() {
  "$@" > /tmp/step.out 2>&1
  rc=$?
  cat /tmp/step.out
  cat /tmp/step.out >> "$LOG"
  return $rc
}

fail() {
  echo "Startup failed at step \"$1\"; see the output above." >&2
  exec node scripts/startup-failed.mjs "$1" "$LOG"
}

step node -e "try { require('./dist/config').config() } catch (e) { console.error(e.message); process.exit(1) }" || fail config

# The database may still be starting: retry for about a minute while it is unreachable.
tries=0
until step ./node_modules/.bin/prisma migrate deploy; do
  tries=$((tries + 1))
  grep -q 'P1001\|P1017' /tmp/step.out && [ "$tries" -lt 12 ] || fail migrate
  echo "Database not reachable yet; retrying in 5 s ($tries/12)"
  sleep 5
done

if [ "${SEED_ON_START:-1}" = "1" ]; then
  step ./node_modules/.bin/tsx prisma/seed.ts || fail seed
fi
exec node dist/main.js
