#!/usr/bin/env bash
# restore.sh — Replace the production database with a dump.
#
# Usage: ./scripts/ops/restore.sh --yes-destroy-current-data <dump-file>
#
# **This deletes the current database.** Every loan recorded, every reader
# registered and every book catalogued since the dump was taken is gone when
# this finishes. There is no undo beyond the safety dump this script takes
# first, described below.
#
# The flag is mandatory, has no short form, and is checked before anything
# else — including before the dump file is looked for. That ordering is
# deliberate: it means the flag cannot be discovered by running the command
# with a real dump in hand and reading the error, which is exactly how someone
# in a hurry learns a flag.
#
# ── When you need this ────────────────────────────────────────────────────────
#
#   - A migration went wrong and deploy.sh aborted at its migration step.
#   - The data directory was lost with the machine.
#   - Someone deleted something they should not have and it matters more than
#     everything recorded since.
#
# In the first case, prefer fixing the migration and running
# `./deploy.sh --migrate-only`. A restore is the last resort, not the first.

set -euo pipefail

COMPOSE_FILE="compose.prod.yaml"
ENV_FILE=".env.prod"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

CONFIRMED=false
DUMP=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --yes-destroy-current-data) CONFIRMED=true; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) error "Unknown option: $1" ;;
    *)  DUMP="$1"; shift ;;
  esac
done

# First, before the file is even looked for. See the header.
if [[ "$CONFIRMED" != true ]]; then
  error "This replaces the entire database and cannot be undone.
        Re-run with the flag if that is what you mean:

          ./scripts/ops/restore.sh --yes-destroy-current-data <dump-file>

        Available dumps:
$(ls -t backups/db/olibra-*.dump 2>/dev/null | head -5 | sed 's/^/          /' || echo '          (none found in backups/db/)')"
fi

[[ -n "$DUMP" ]] || error "No dump file given. Usage: ./scripts/ops/restore.sh --yes-destroy-current-data <dump-file>"
[[ -f "$DUMP" ]] || error "Dump file not found: $DUMP"
head -c 5 "$DUMP" | grep -q "PGDMP" || error "$DUMP is not a pg_dump custom-format file. Restoring it would fail partway through, having already dropped the current schema."

DUMP=$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")

cd "$(dirname "$0")/../.." || error "Could not find the repository root."

[[ -f "$ENV_FILE" ]]     || error "$ENV_FILE not found."
[[ -f "$COMPOSE_FILE" ]] || error "$COMPOSE_FILE not found."

COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

get_env_value() {
  local key="$1" value
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)
  printf '%s' "${value%$'\r'}"
}

POSTGRES_USER=$(get_env_value POSTGRES_USER); POSTGRES_USER="${POSTGRES_USER:-olibra}"
POSTGRES_DB=$(get_env_value POSTGRES_DB);     POSTGRES_DB="${POSTGRES_DB:-olibra}"

echo ""
warn "About to replace '$POSTGRES_DB' with:"
warn "  $DUMP  ($(du -h "$DUMP" | cut -f1), taken $(date -r "$DUMP" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'unknown'))"
warn "Everything recorded since then will be lost."
echo ""
read -r -p "Type the database name to confirm: " typed
[[ "$typed" == "$POSTGRES_DB" ]] || error "Got '$typed', expected '$POSTGRES_DB'. Nothing has changed."

# ─── A safety dump of what is about to be destroyed ───────────────────────────
# Even a deliberate restore is sometimes the wrong restore — the wrong file, or
# the right file and a worse outcome than the problem. This is the only way back
# from that, and it costs seconds.
info "Taking a safety dump of the current database first..."
mkdir -p backups/db
SAFETY="backups/db/pre-restore-$(date -u +%Y%m%d-%H%M%SZ).dump"
if "${COMPOSE[@]}" exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$SAFETY" 2>/dev/null && [[ -s "$SAFETY" ]]; then
  chmod 600 "$SAFETY"
  success "Safety dump: $SAFETY"
else
  rm -f "$SAFETY"
  warn "Could not take a safety dump — the database may already be unreachable."
  read -r -p "Continue without one? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || error "Stopped. Nothing has changed."
fi

# ─── Stop everything that writes ──────────────────────────────────────────────
# `app` serves requests and `sweep` writes notifications at 07:00. A restore
# racing either one produces a database that matches neither the dump nor what
# was there before.
info "Stopping app and sweep..."
"${COMPOSE[@]}" stop app sweep 2>/dev/null || true

# ─── Restore ──────────────────────────────────────────────────────────────────
# `--clean --if-exists` drops each object before recreating it, so this works
# against a populated database as well as an empty one. Not `--create`: the
# database already exists, made by the postgres image's own entrypoint.
#
# pg_restore exits non-zero on warnings that are routine here (dropping an
# object that was not there), so its output is shown rather than trusted, and
# the verification below is what actually decides.
info "Restoring..."
if ! "${COMPOSE[@]}" exec -T db pg_restore \
      -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges < "$DUMP"; then
  warn "pg_restore reported errors. Some are routine (dropping objects that did not exist); some are not."
  warn "The verification below is what decides."
fi

# ─── Verify before declaring success ──────────────────────────────────────────
info "Verifying..."
TABLES=$("${COMPOSE[@]}" exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At \
  -c "select count(*) from information_schema.tables where table_schema = 'public';" 2>/dev/null || echo "0")

if [[ "${TABLES:-0}" -lt 1 ]]; then
  error "The restored database has no tables in the public schema. The restore did not work.
        The safety dump is at: ${SAFETY:-<none taken>}
        app and sweep are still stopped. Do not start them against this database."
fi
success "Restored: $TABLES table(s) in the public schema."

info "Restarting app and sweep..."
"${COMPOSE[@]}" up -d app sweep

echo ""
success "Restore complete."
info "Check by hand before telling anyone it worked:"
info "  - Sign in as a known reader."
info "  - Open a bookshelf's catalogue and confirm the book count looks right."
info "  - Open a reader's profile and confirm a date of birth reads correctly."
info "  - Confirm a cover image loads (that is the object store, not this dump)."
