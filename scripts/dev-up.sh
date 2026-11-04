#!/usr/bin/env bash
#
# Start Vault locally: database checks, API, and the administrator console.
#
#   bash scripts/dev-up.sh
#
# Stops with Ctrl-C. Everything it starts is a development configuration:
# HTTP on loopback, no TLS. Read the deployment notes in README.md before
# exposing any of this beyond your own machine.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-5173}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

say "Checking prerequisites"
command -v node >/dev/null || fail "node is not installed"
command -v psql >/dev/null || fail "postgres client (psql) is not installed"
pg_isready >/dev/null 2>&1 || fail "PostgreSQL is not running. Start it with: brew services start postgresql@16"
printf '  node %s, postgres reachable\n' "$(node -v)"

[ -f "$ROOT/backend/.env" ] || fail "backend/.env is missing. Copy backend/.env.example, then: cd backend && npm run gen:keys"
for key in JWT_SECRET SERVER_PEPPER STORAGE_KEK IP_HASH_SALT; do
  grep -qE "^${key}=.+" "$ROOT/backend/.env" || fail "$key is empty in backend/.env — run: cd backend && npm run gen:keys"
done
printf '  backend/.env present with all four secrets\n'

[ -d "$ROOT/backend/node_modules" ]   || fail "backend dependencies missing. Run: cd backend && npm install"
[ -d "$ROOT/admin-web/node_modules" ] || fail "admin console dependencies missing. Run: cd admin-web && npm install"

say "Preparing the database"
DB_URL="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" | cut -d= -f2-)"
DB_NAME="${DB_URL##*/}"

if ! psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  printf '  creating database %s\n' "$DB_NAME"
  createdb "$DB_NAME" || fail "could not create database $DB_NAME"
fi
( cd "$ROOT/backend" && npx prisma migrate deploy >/dev/null 2>&1 ) \
  || fail "migrations failed. Run manually: cd backend && npx prisma migrate deploy"
printf '  %s is migrated\n' "$DB_NAME"

ADMIN_COUNT="$(psql -d "$DB_NAME" -tAc 'SELECT count(*) FROM admins' 2>/dev/null || echo 0)"
if [ "$ADMIN_COUNT" = "0" ]; then
  say "No administrator exists yet"
  cat <<'MSG'
  Create one now, in a second terminal:

      cd backend && npm run bootstrap:admin

  It prints your two-factor secret and recovery codes exactly once.
  Then sign in to the console and set the Document Master Password —
  until it is set, no document contents are readable by anyone.
MSG
fi

cleanup() {
  printf '\nStopping...\n'
  [ -n "${API_PID:-}" ]   && kill "$API_PID" 2>/dev/null
  [ -n "${ADMIN_PID:-}" ] && kill "$ADMIN_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

say "Building the API"
# Shown rather than swallowed: a build failure is the single most common thing
# to go wrong here, and hiding the compiler output makes it unfixable.
( cd "$ROOT/backend" && npm run build ) || fail "backend build failed — the compiler output is above"

say "Starting the API"
( cd "$ROOT/backend" && PORT="$API_PORT" node dist/main.js ) &
API_PID=$!

for _ in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/nope" 2>/dev/null && break
  sleep 1
done
printf '  API on http://127.0.0.1:%s\n' "$API_PORT"

say "Starting the administrator console"
( cd "$ROOT/admin-web" && VITE_API_BASE="http://127.0.0.1:$API_PORT" npm run dev -- --port "$ADMIN_PORT" >/dev/null 2>&1 ) &
ADMIN_PID=$!
sleep 3
printf '  Console on http://localhost:%s\n' "$ADMIN_PORT"

cat <<MSG

──────────────────────────────────────────────────────────────────────
  Administrator console   http://localhost:$ADMIN_PORT
  API                     http://127.0.0.1:$API_PORT/api/v1

  The mobile client is separate:
      cd client-app
      flutter run --dart-define=VAULT_BASE_URL=http://<your-lan-ip>:$API_PORT

  Ctrl-C to stop.
──────────────────────────────────────────────────────────────────────
MSG

wait
