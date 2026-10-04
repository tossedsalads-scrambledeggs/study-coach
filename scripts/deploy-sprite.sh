#!/usr/bin/env bash
# Deploy Study Coach to a Fly.io Sprite: the app lives on its own computer, sleeps when idle,
# and wakes on the next request or email webhook.
# Usage: scripts/deploy-sprite.sh [sprite-name]   (needs the `sprite` CLI, logged in, and a local .env)
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite remote paths like /home/sprite

SPRITE="${1:-study-coach}"
REPO="https://github.com/tossedsalads-scrambledeggs/study-coach.git"
APP=/home/sprite/app
SPRITE_CLI="${SPRITE_CLI:-sprite}"

run() { "$SPRITE_CLI" exec -s "$SPRITE" -- bash -lc "$1"; }

echo "== code"
run "if [ -d $APP/.git ]; then cd $APP && git fetch -q origin && git reset -q --hard origin/main; else git clone -q $REPO $APP; fi && cd $APP && git log --oneline -1"

echo "== env (piped in, never printed)"
"$SPRITE_CLI" exec -s "$SPRITE" -- bash -c "umask 077 && cat > $APP/.env" < .env

echo "== install + build"
run "cd $APP && npm ci --no-audit --no-fund --loglevel=error && npm run build 2>&1 | tail -15"

echo "== service on port 8080 (wakes on request)"
run "if sprite-env services get web >/dev/null 2>&1; then sprite-env services restart web --duration 10s; else sprite-env services create web --cmd \$(command -v npm) --args 'run,start,--,-p,8080' --dir $APP --http-port 8080 --duration 10s; fi" | tail -5

echo "== public URL"
"$SPRITE_CLI" config update --url-auth public -s "$SPRITE" >/dev/null 2>&1 || "$SPRITE_CLI" url update --auth public -s "$SPRITE" >/dev/null 2>&1 || true
"$SPRITE_CLI" info -s "$SPRITE" 2>/dev/null | grep -iE "url|auth" || "$SPRITE_CLI" url -s "$SPRITE"
