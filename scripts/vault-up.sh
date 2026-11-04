#!/usr/bin/env bash
#
# Start Vault: the API, the website, and (optionally) the public tunnel.
#
#   bash scripts/vault-up.sh            # local only, http://localhost:8080
#   bash scripts/vault-up.sh --public   # also opens it to the internet
#
# Ctrl-C stops everything.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-8080}"
ADMIN_PORT="${ADMIN_PORT:-5173}"
PUBLIC=0
[ "${1:-}" = "--public" ] && PUBLIC=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "Checking prerequisites"
command -v node >/dev/null || fail "node is not installed"
command -v psql >/dev/null || fail "postgres client (psql) is not installed"

if ! pg_isready >/dev/null 2>&1; then
  printf '  starting PostgreSQL…\n'
  brew services start postgresql@16 >/dev/null 2>&1
  for _ in $(seq 1 20); do pg_isready >/dev/null 2>&1 && break; sleep 1; done
  pg_isready >/dev/null 2>&1 || fail "PostgreSQL will not start. Check: tail /opt/homebrew/var/log/postgresql@16.log"
fi
printf '  node %s, postgres reachable\n' "$(node -v)"

[ -f "$ROOT/backend/.env" ] || fail "backend/.env is missing. Copy .env.example, then: cd backend && npm run gen:keys"
for key in JWT_SECRET SERVER_PEPPER STORAGE_KEK IP_HASH_SALT; do
  grep -qE "^${key}=.+" "$ROOT/backend/.env" || fail "$key is empty in backend/.env — run: cd backend && npm run gen:keys"
done
[ -d "$ROOT/backend/node_modules" ]    || fail "run: cd backend && npm install"
[ -d "$ROOT/web-client/node_modules" ] || fail "run: cd web-client && npm install"
printf '  configuration present\n'

say "Preparing the database"
DB_NAME="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2- | sed 's|.*/||')"
psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME" || createdb "$DB_NAME" || fail "could not create $DB_NAME"
( cd "$ROOT/backend" && npx prisma migrate deploy >/dev/null 2>&1 ) || fail "migrations failed: cd backend && npx prisma migrate deploy"
printf '  %s is ready\n' "$DB_NAME"

if [ "$(psql -d "$DB_NAME" -tAc 'SELECT count(*) FROM admins' 2>/dev/null || echo 0)" = "0" ]; then
  say "No administrator exists yet"
  printf '  In another terminal, run:  cd backend && npm run bootstrap:admin\n'
fi

say "Building"
( cd "$ROOT/backend" && npm run build ) || fail "backend build failed — output above"
( cd "$ROOT/web-client" && npm run build >/dev/null 2>&1 ) || fail "website build failed: cd web-client && npm run build"
printf '  built\n'

# Anything still holding one of our ports, gone — by port, not by PID.
#
# Killing a recorded PID is not enough. `npm run dev` execs vite as a *child*,
# so terminating npm orphans vite, which keeps the port bound while no longer
# serving anything. The result is a process that answers nothing and blocks the
# next start with "port already in use". Sweeping by port catches the orphan
# whatever its PID turned out to be.
free_port() {
  local port="$1" pids
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  # CONT before TERM: a suspended process (Ctrl-Z) has signals queued but never
  # runs its handler, so it survives a plain kill and keeps the port bound.
  echo "$pids" | xargs kill -CONT 2>/dev/null || true
  echo "$pids" | xargs kill 2>/dev/null || true
  sleep 1
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
  return 0
}

cleanup() {
  trap - INT TERM EXIT
  printf '\nStopping…\n'
  for pid in "${API_PID:-}" "${WEB_PID:-}" "${ADMIN_PID:-}" "${TUNNEL_PID:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # Then the sweep, for the grandchildren the PIDs above do not cover.
  for port in "$API_PORT" "$WEB_PORT" "$ADMIN_PORT"; do free_port "$port"; done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

# A previous run that was killed hard, or crashed, can leave a listener behind.
# Clear the ports before claiming them rather than failing on "already in use".
for port in "$API_PORT" "$WEB_PORT" "$ADMIN_PORT"; do free_port "$port"; done

say "Starting"
( cd "$ROOT/backend" && PORT="$API_PORT" HOST=127.0.0.1 node dist/main.js >/dev/null 2>&1 ) &
API_PID=$!
for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/nope" 2>/dev/null && break
  sleep 1
done
printf '  API ready\n'

( cd "$ROOT" && PORT="$WEB_PORT" API_ORIGIN="http://127.0.0.1:$API_PORT" node edge/server.mjs >/dev/null 2>&1 ) &
WEB_PID=$!
sleep 2
printf '  Website on http://localhost:%s\n' "$WEB_PORT"

# The administrator console is bound to loopback and never goes through the
# tunnel. You administer from this machine; the tunnel carries only the
# client-facing site.
if [ -d "$ROOT/admin-web/node_modules" ]; then
  ( cd "$ROOT/admin-web" && VITE_API_BASE="http://127.0.0.1:$API_PORT" npm run dev -- --port "$ADMIN_PORT" >/dev/null 2>&1 ) &
  ADMIN_PID=$!
  sleep 2
  printf '  Admin console on http://localhost:%s (this machine only)\n' "$ADMIN_PORT"
fi

PUBLIC_URL=""
if [ "$PUBLIC" = "1" ]; then
  command -v cloudflared >/dev/null || fail "cloudflared is not installed. Run: brew install cloudflared"
  say "Opening the public address"
  TUNNEL_LOG="$(mktemp)"
  # --protocol http2: many home and mobile networks block QUIC/UDP, and the
  # default transport silently fails to connect when they do.
  cloudflared tunnel --url "http://127.0.0.1:$WEB_PORT" --protocol http2 --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 40); do
    PUBLIC_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)"
    [ -n "$PUBLIC_URL" ] && break
    sleep 1
  done
  [ -n "$PUBLIC_URL" ] || printf '  could not read the address — see %s\n' "$TUNNEL_LOG"
fi

cat <<MSG

──────────────────────────────────────────────────────────────────────
  On this machine
    Website          http://localhost:$WEB_PORT
    Admin console    http://localhost:$ADMIN_PORT
MSG
if [ -n "$PUBLIC_URL" ]; then
cat <<MSG
  From anywhere
    $PUBLIC_URL

  Open that on any phone, on mobile data, anywhere in the world.
  The address changes each time you start with --public.
MSG
fi
cat <<'MSG'

  Ctrl-C to stop.
──────────────────────────────────────────────────────────────────────
MSG

wait
