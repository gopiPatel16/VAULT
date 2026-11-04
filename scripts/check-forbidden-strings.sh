#!/usr/bin/env bash
#
# Infrastructure-vocabulary lint.
#
# ARCHITECTURE §2 and §21 forbid a set of words from ever reaching a client
# user, and §13 forbids master-password management from existing in the client
# at all. Reviewers do not reliably catch a new "Server unavailable" string in
# a diff, so this runs in CI and fails the build instead.
#
#   bash scripts/check-forbidden-strings.sh
#
# What it checks:
#   1. the public error-code vocabulary the backend can emit
#   2. every user-facing string literal in the client application
#   3. that no password-management identifier exists in the client
#
# It deliberately does NOT scan backend internals: server logs are supposed to
# say "connection refused" in as much detail as possible. It also strips
# comments before scanning the client, because a comment explaining *why*
# there is no forgot-password flow is the opposite of a violation.
#
# ── Implementation note ─────────────────────────────────────────────────────
# An earlier version drove the scan with `xargs -I{} sh -c ...`. On BSD xargs
# that hits "command line cannot be assembled, too long" once the repository
# path grows, and the error was being swallowed by `2>/dev/null || true` — so
# the check reported "ok" no matter what the files contained. A security lint
# that cannot fail is worse than no lint, because it is trusted. Hence the
# plain read loop below, and hence `set -e` is NOT used to mask exit codes.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0

# Words that must never appear in anything a client user can see.
FORBIDDEN='server|home computer|offline|online|unreachable|econnrefused|connection refused|host unreachable|connection timeout|database|hostname|ip address|filesystem|localhost|127\.0\.0\.1|powered off|port [0-9]'

# Identifiers that must not exist in the client at all (§13).
PASSWORD_MGMT='change.?password|reset.?password|forgot.?password|recover.?password|remove.?password|set.?master.?password'

say() { printf '%s\n' "$*"; }

# ── 1. Backend public error vocabulary ──────────────────────────────────────
say "→ checking the public error-code vocabulary"

CODES_FILE="$ROOT/backend/src/common/errors/public-error-codes.ts"
if [[ ! -f "$CODES_FILE" ]]; then
  say "  FAIL: $CODES_FILE is missing"
  FAILED=1
else
  # Only the string literals, not the comments explaining them.
  HITS="$(grep -nE "^[[:space:]]+[A-Z_]+: '[^']+'" "$CODES_FILE" | grep -iE "$FORBIDDEN")"
  if [[ -n "$HITS" ]]; then
    say "  FAIL: a public error code contains forbidden vocabulary"
    printf '%s\n' "$HITS"
    FAILED=1
  else
    say "  ok"
  fi
fi

CLIENT_DIR="$ROOT/client-app"

if [[ ! -d "$CLIENT_DIR/lib" ]]; then
  say "→ client checks skipped (no client application yet)"
else
  DART_FILES="$(find "$CLIENT_DIR/lib" -name '*.dart' -type f)"

  if [[ -z "$DART_FILES" ]]; then
    say "  FAIL: client-app/lib exists but contains no Dart files"
    FAILED=1
  fi

  # ── 2. Client-facing string literals ──────────────────────────────────────
  say "→ checking client-facing strings"

  STRING_HITS=""
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    stripped="$(sed -e 's://.*::' "$file")"
    matches="$(printf '%s\n' "$stripped" \
      | grep -oE "'[^']{4,}'|\"[^\"]{4,}\"" \
      | grep -iE "$FORBIDDEN")"
    if [[ -n "$matches" ]]; then
      STRING_HITS+="$(printf '%s\n' "$matches" | sed "s|^|${file#"$ROOT/"}: |")"$'\n'
    fi
  done <<< "$DART_FILES"

  if [[ -n "$STRING_HITS" ]]; then
    say "  FAIL: client strings reveal infrastructure:"
    printf '%s' "$STRING_HITS"
    FAILED=1
  else
    say "  ok"
  fi

  # ── 3. No master-password management in the client ────────────────────────
  say "→ checking the client has no master-password management"

  MGMT_HITS=""
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    matches="$(sed -e 's://.*::' "$file" | grep -niE "$PASSWORD_MGMT")"
    if [[ -n "$matches" ]]; then
      MGMT_HITS+="$(printf '%s\n' "$matches" | sed "s|^|${file#"$ROOT/"}:|")"$'\n'
    fi
  done <<< "$DART_FILES"

  if [[ -n "$MGMT_HITS" ]]; then
    say "  FAIL: the client must not contain password management (ARCHITECTURE §13):"
    printf '%s' "$MGMT_HITS"
    FAILED=1
  else
    say "  ok"
  fi
fi

say ""
if [[ "$FAILED" -eq 0 ]]; then
  say "PASS — no infrastructure vocabulary on any client-facing surface."
else
  say "FAIL — see above."
fi
exit "$FAILED"
