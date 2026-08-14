#!/usr/bin/env bash
# backup.sh — Dump the production database and mirror the object store.
#
# Usage: ./scripts/ops/backup.sh [--keep <n>] [--quiet]
#
# Options:
#   --keep <n>   Keep the newest n dumps (default 14). Older ones are deleted.
#   --quiet      Only print on failure. For the cron entry.
#
# Run by deploy.sh before every deploy, and by the nightly cron entry
# scripts/ops/bootstrap-vps.sh installs (03:00 Asia/Ho_Chi_Minh).
#
# ── Why this exists at all ───────────────────────────────────────────────────
#
# compose.prod.yaml bind-mounts ./data/postgres, and compose.yaml's own header
# says "Back up that one directory and you have backed up everything." That is
# true of MinIO's half and **dangerously untrue of Postgres's while the server
# is running**: a file-level copy of a live data directory catches some pages
# mid-write and some WAL segments not yet applied, and the result restores as a
# corrupt cluster — or worse, as one that starts and is quietly wrong. The
# directory is right there, which is exactly why the distinction is written
# down here rather than assumed.
#
# `pg_dump -Fc` takes a consistent snapshot inside a transaction, and produces
# something `pg_restore` can read selectively. For a shelf of a few hundred
# books it is measured in megabytes and takes seconds.

set -euo pipefail

COMPOSE_FILE="compose.prod.yaml"
ENV_FILE=".env.prod"
BACKUP_DIR="backups"
KEEP=14
QUIET=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { [[ "$QUIET" == true ]] || echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { [[ "$QUIET" == true ]] || echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*" >&2; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --keep)  KEEP="${2:-}"; [[ "$KEEP" =~ ^[0-9]+$ ]] || error "--keep needs a number."; shift 2 ;;
    --quiet) QUIET=true; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) error "Unknown option: $1" ;;
  esac
done

# Run from the repository root regardless of where this was invoked from — the
# cron entry calls it by absolute path, and every path below is relative.
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
S3_BUCKET=$(get_env_value S3_BUCKET);         S3_BUCKET="${S3_BUCKET:-olibra}"
S3_ACCESS_KEY_ID=$(get_env_value S3_ACCESS_KEY_ID)
S3_SECRET_ACCESS_KEY=$(get_env_value S3_SECRET_ACCESS_KEY)

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/storage"

# UTC in the filename, deliberately, even though the application runs on
# Asia/Ho_Chi_Minh: a timestamp that jumps or repeats is a poor sort key, and
# these files are read by `ls` far more often than by a person reasoning about
# local time.
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
DUMP="$BACKUP_DIR/db/olibra-${STAMP}.dump"

# ─── Database ─────────────────────────────────────────────────────────────────
info "Dumping $POSTGRES_DB ..."

# `exec -T` — no TTY — because this runs unattended from cron, where a TTY
# request fails outright.
if ! "${COMPOSE[@]}" exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DUMP" 2>/dev/null; then
  rm -f "$DUMP"
  error "pg_dump failed. Is the db service running?  ${COMPOSE[*]} ps db"
fi

# A dump that exists and is empty is worse than no dump, because it looks like
# a rollback point. pg_dump's custom format starts with the magic "PGDMP".
if [[ ! -s "$DUMP" ]]; then
  rm -f "$DUMP"
  error "pg_dump produced an empty file. Nothing has been kept."
fi
if ! head -c 5 "$DUMP" | grep -q "PGDMP"; then
  rm -f "$DUMP"
  error "pg_dump produced something that is not a custom-format dump. Nothing has been kept."
fi

# Every personal field in the system is in this file — children's names, dates
# of birth, parents' names, phone numbers.
chmod 600 "$DUMP"
success "Database dumped: $DUMP ($(du -h "$DUMP" | cut -f1))"

# ─── Object store ─────────────────────────────────────────────────────────────
# A throwaway `mc` container on the stack's own network, so this needs no mc on
# the host and no published MinIO port. `--overwrite` rather than `--remove`:
# an object deleted from the bucket stays in the mirror, which is what you want
# from a backup and not what you want from a sync.
info "Mirroring bucket '$S3_BUCKET' ..."
NETWORK=$("${COMPOSE[@]}" ps --format '{{.Name}}' storage 2>/dev/null | head -n1)
if [[ -z "$NETWORK" ]]; then
  warn "The storage service is not running — skipping the object mirror. The database dump above is complete."
else
  if docker run --rm \
      --network "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$NETWORK")" \
      -v "$PWD/$BACKUP_DIR/storage:/mirror" \
      --entrypoint /bin/sh \
      minio/mc:RELEASE.2025-04-16T18-13-26Z -c "
        set -e
        mc alias set olibra http://storage:9000 '$S3_ACCESS_KEY_ID' '$S3_SECRET_ACCESS_KEY' >/dev/null
        mc mirror --overwrite --quiet olibra/$S3_BUCKET /mirror
      " 2>/dev/null; then
    success "Objects mirrored: $BACKUP_DIR/storage ($(du -sh "$BACKUP_DIR/storage" | cut -f1))"
  else
    warn "The object mirror failed. The database dump above is complete and usable."
  fi
fi

# ─── Retention ────────────────────────────────────────────────────────────────
# Newest first, drop everything past the keep count.
#
# A `while read` loop rather than `mapfile`, which is bash 4+: the VPS has it,
# but this script is edited and syntax-checked on macOS, where /bin/bash is
# still 3.2. A backup script that only runs on one of the two machines it lives
# on is a bad thing to discover from cron.
PRUNED=0
while IFS= read -r old; do
  [[ -n "$old" ]] || continue
  rm -f "$old"
  PRUNED=$((PRUNED + 1))
done < <(ls -t "$BACKUP_DIR"/db/olibra-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) || true)
(( PRUNED == 0 )) || info "Pruned $PRUNED dump(s) beyond the newest $KEEP."

REMAINING=$(ls -1 "$BACKUP_DIR"/db/olibra-*.dump 2>/dev/null | wc -l | tr -d ' ')
success "Backup complete. $REMAINING dump(s) retained in $BACKUP_DIR/db/"

# ─── A backup nobody can restore is not a backup ──────────────────────────────
info "Restore with:  ./scripts/ops/restore.sh --yes-destroy-current-data $DUMP"
