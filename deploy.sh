#!/usr/bin/env bash
# deploy.sh — Build and redeploy OLibra on a production VPS.
#
# Usage: ./deploy.sh [--domain <d>] [--no-pull] [--no-build] [--no-backup]
#                    [--service <name>] [--migrate-only] [-h|--help]
#
# Options:
#   --domain <d>     The apex domain. Written into .env.prod on the first
#                    deploy; overrides the stored value for this run only.
#   --no-pull        Skip `git pull` (deploying from a CI artifact, or a box
#                    with no credentials for the remote).
#   --no-build       Skip the image build and use whatever `olibra-app:prod`
#                    already is. The path for a prebuilt image from a registry.
#   --no-backup      Skip the pre-deploy database dump. Think before using it:
#                    the backup is what stands between a bad migration and a
#                    parish's records.
#   --service <n>    Rebuild and restart one service only (app, sweep, caddy,
#                    db, storage). Still runs the preflight and the health gate.
#   --migrate-only   Run the migration and stop. Nothing is built or restarted.
#   -h, --help       This message.
#
# What a full run does, in order:
#
#   1. preflight     eight checks; nothing has changed yet
#   2. git pull
#   3. backup        pg_dump BEFORE anything moves
#   4. up db+storage wait for both healthchecks
#   5. stop app+sweep frees ~700 MB for the build
#   6. build
#   7. migrate       new image, superuser credential; failure aborts here
#   8. up            everything
#   9. verify        container health AND an HTTPS probe from outside
#
# Expect two to five minutes of downtime around steps 5-8. On a 2 GB box you
# cannot both build in place and stay up; see
# docs/superpowers/specs/2026-08-14-vps-deployment-design.md §3.1. `--no-build`
# is the way out of that trade once an image is built elsewhere.
#
# Examples:
#   ./deploy.sh --domain olibra.example      # first deploy
#   ./deploy.sh                              # routine deploy
#   ./deploy.sh --service app                # just the application
#   ./deploy.sh --migrate-only               # apply migrations, change nothing else

set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
COMPOSE_FILE="compose.prod.yaml"
ENV_FILE=".env.prod"
BACKUP_SCRIPT="scripts/ops/backup.sh"
IMAGE="olibra-app:prod"

# An array, so no later call can drift onto the wrong compose file or the wrong
# environment. Every docker invocation below goes through it.
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# The build needs roughly 2 GB and the box has 2 GB, so swap is not optional.
# Expressed in MiB to match `free -m`.
MIN_SWAP_MB=1024
MIN_DISK_GB=5

# ─── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

print_help() {
  # The file's own header, which is the only copy of this text.
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

# ─── Parse args ───────────────────────────────────────────────────────────────
DOMAIN_FLAG=""
NO_PULL=false
NO_BUILD=false
NO_BACKUP=false
MIGRATE_ONLY=false
TARGET_SERVICE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --domain)       DOMAIN_FLAG="${2:-}"; [[ -n "$DOMAIN_FLAG" ]] || error "--domain needs a value."; shift 2 ;;
    --no-pull)      NO_PULL=true; shift ;;
    --no-build)     NO_BUILD=true; shift ;;
    --no-backup)    NO_BACKUP=true; shift ;;
    --migrate-only) MIGRATE_ONLY=true; shift ;;
    --service)      TARGET_SERVICE="${2:-}"; [[ -n "$TARGET_SERVICE" ]] || error "--service needs a value."; shift 2 ;;
    -h|--help)      print_help; exit 0 ;;
    *)              error "Unknown option: $1" ;;
  esac
done

# ─── Reading and writing .env.prod ────────────────────────────────────────────
# Read a key without sourcing the file. Sourcing would execute whatever is in
# it, and a value containing a space or a `#` would arrive mangled — which is
# exactly the class of defect .env.example's own comments were written about.
get_env_value() {
  local key="$1" value
  [[ -f "$ENV_FILE" ]] || { printf ''; return; }
  value=$(grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  printf '%s' "$value"
}

# Replace a key's value in place, or append the line if the key is absent.
set_env_value() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # A literal `|` is impossible in a domain, so it is a safe sed delimiter
    # here in a way that `/` would not be.
    sed "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# A secret is missing if it is empty, still the template's placeholder, or —
# the case .env.example records at length — a swallowed comment. `compose`'s
# own `${VAR:?}` guards reject only the first of those three.
require_secret() {
  local key="$1" value
  value=$(get_env_value "$key")
  [[ -n "$value" ]] || error "$key is empty in $ENV_FILE. Generate one: openssl rand -base64 32 | tr -d '/+=' | head -c 32"
  [[ "$value" != "CHANGE_ME" ]] || error "$key is still CHANGE_ME in $ENV_FILE."
  [[ "$value" != *"#"* ]] || error "$key in $ENV_FILE contains a '#'. A comment on the same line as a value becomes part of the value — move it to its own line above."
}

# ─── Preflight ────────────────────────────────────────────────────────────────
APP_DOMAIN=""

preflight() {
  info "Preflight..."

  [[ -f "$ENV_FILE" ]]     || error "$ENV_FILE not found. Copy .env.prod.example and fill it in."
  [[ -f "$COMPOSE_FILE" ]] || error "$COMPOSE_FILE not found. Are you in the repository root?"
  command -v docker &>/dev/null || error "docker is not installed or not in PATH. Run scripts/ops/bootstrap-vps.sh first."
  docker info &>/dev/null       || error "The Docker daemon is not responding. Try: sudo systemctl start docker"

  # The domain. --domain wins for this run, and is persisted when the file has
  # no real value yet, so only the first deploy needs the flag.
  local stored
  stored=$(get_env_value APP_DOMAIN)
  if [[ -n "$DOMAIN_FLAG" ]]; then
    APP_DOMAIN="$DOMAIN_FLAG"
    if [[ "$stored" == "$APP_DOMAIN" ]]; then
      :
    elif [[ -z "$stored" || "$stored" == "CHANGE_ME" ]]; then
      set_env_value APP_DOMAIN "$APP_DOMAIN"
      success "APP_DOMAIN written to $ENV_FILE: $APP_DOMAIN"
    else
      warn "$ENV_FILE says APP_DOMAIN=$stored; --domain says $APP_DOMAIN."
      warn "Changing it re-issues certificates and changes the host in every stored image URL."
      read -r -p "Overwrite the stored value? [y/N] " reply
      [[ "$reply" == "y" || "$reply" == "Y" ]] || error "Left $ENV_FILE unchanged. Re-run without --domain to deploy on $stored."
      set_env_value APP_DOMAIN "$APP_DOMAIN"
    fi
  else
    APP_DOMAIN="$stored"
  fi
  [[ -n "$APP_DOMAIN" ]]            || error "APP_DOMAIN is not set. Pass --domain <your-domain>, or set it in $ENV_FILE."
  [[ "$APP_DOMAIN" != "CHANGE_ME" ]] || error "APP_DOMAIN is still CHANGE_ME. Pass --domain <your-domain>."

  # The broken-images failure. compose.prod.yaml derives S3_PUBLIC_URL from
  # APP_DOMAIN, so this only fires if someone has added an override by hand.
  local public_url
  public_url=$(get_env_value S3_PUBLIC_URL)
  if [[ -n "$public_url" && "$public_url" == *"localhost"* ]]; then
    error "S3_PUBLIC_URL in $ENV_FILE points at localhost. Every cover and avatar would be a broken image. Remove the line and let compose.prod.yaml derive it."
  fi

  require_secret POSTGRES_PASSWORD
  require_secret OLIBRA_POOL_PASSWORD
  require_secret S3_ACCESS_KEY_ID
  require_secret S3_SECRET_ACCESS_KEY

  # Swap, unless nothing is going to be built. `free` is Linux-only; on a Mac
  # (where this script is edited but not run) the check is skipped rather than
  # failing on a missing binary.
  if [[ "$NO_BUILD" == false && "$MIGRATE_ONLY" == false ]] && command -v free &>/dev/null; then
    local swap_mb mem_mb
    swap_mb=$(free -m | awk '/^Swap:/ {print $2}')
    mem_mb=$(free -m | awk '/^Mem:/ {print $2}')
    info "Memory: ${mem_mb}MB RAM, ${swap_mb}MB swap"
    if (( swap_mb < MIN_SWAP_MB )); then
      error "Only ${swap_mb}MB of swap. \`next build\` peaks near 2GB and will be killed without it.
        Run: sudo ./scripts/ops/bootstrap-vps.sh --yes
        Or add swap by hand:
          sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
          sudo mkswap /swapfile && sudo swapon /swapfile
          echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
    fi
  fi

  # Disk. A Docker build that fills the disk does not merely fail; it can leave
  # the image store corrupt.
  if command -v df &>/dev/null; then
    local free_gb
    free_gb=$(df -Pk . | awk 'NR==2 {print int($4/1048576)}')
    (( free_gb >= MIN_DISK_GB )) || error "Only ${free_gb}GB free on this filesystem; ${MIN_DISK_GB}GB is the floor for a build. Try: docker system prune -af"
  fi

  success "Preflight passed. Deploying $APP_DOMAIN"
}

# ─── Steps ────────────────────────────────────────────────────────────────────
pull_code() {
  info "Pulling latest code..."
  git pull --rebase || error "git pull failed. Resolve it and re-run."
  success "Code updated: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
}

run_backup() {
  if [[ ! -x "$BACKUP_SCRIPT" ]]; then
    warn "$BACKUP_SCRIPT not found or not executable — skipping the pre-deploy backup."
    warn "This deploy has no rollback point. Ctrl-C now if that is not what you want."
    sleep 5
    return
  fi
  info "Backing up before anything changes..."
  "$BACKUP_SCRIPT" || error "Backup failed. Refusing to deploy without a rollback point. Use --no-backup to override, deliberately."
}

wait_healthy() {
  local service="$1" max_attempts="${2:-24}" sleep_seconds=5 container status attempt

  container=$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null | head -n 1)
  [[ -n "$container" ]] || error "Service '$service' is not running."

  info "Waiting for '$service' to become healthy..."
  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$container" 2>/dev/null || true)
    [[ -n "$status" ]] || status="unknown"
    info "  $service check $attempt/$max_attempts: $status"

    case "$status" in
      healthy|running) success "'$service' is $status."; return 0 ;;
      exited|dead)     error "'$service' has $status. Logs:\n$("${COMPOSE[@]}" logs --tail=40 "$service" 2>&1)" ;;
    esac
    sleep "$sleep_seconds"
  done

  error "'$service' did not become healthy within $((max_attempts * sleep_seconds))s.
        Logs: ${COMPOSE[*]} logs --tail=80 $service"
}

run_migration() {
  info "Running database migrations..."
  info "  (the 'migrate' service — its own service so 'app' need not hold the superuser credential)"
  if ! "${COMPOSE[@]}" run --rm migrate; then
    error "Migration failed. Nothing has been restarted; 'app' and 'sweep' are stopped.
        The database is as the pre-deploy backup left it — see backups/db/ for the newest dump
        and docs/DEPLOYMENT.md for the restore procedure.
        Fix the migration, then re-run: ./deploy.sh --migrate-only"
  fi
  success "Migrations applied."
}

probe_https() {
  # The only check that exercises DNS, TLS, the Caddy route, the proxy headers
  # and the application together. Everything before this can pass while the site
  # is unreachable.
  local url="https://${APP_DOMAIN}/" attempt max_attempts=12 body

  info "Probing $url ..."
  for ((attempt=1; attempt<=max_attempts; attempt++)); do
    if body=$(curl -fsS --max-time 15 "$url" 2>/dev/null); then
      if grep -q "OLibra" <<<"$body"; then
        success "$url serves the landing page."
        return 0
      fi
      warn "  attempt $attempt/$max_attempts: 200, but the body does not mention OLibra."
    else
      info "  attempt $attempt/$max_attempts: not answering yet (a first certificate can take ~30s)"
    fi
    sleep 10
  done

  warn "$url did not serve the landing page within $((max_attempts * 10))s."
  warn "The containers are up — this is DNS, the certificate, or the proxy. Check:"
  warn "  ${COMPOSE[*]} logs --tail=50 caddy"
  warn "  dig +short $APP_DOMAIN storage.$APP_DOMAIN"
  return 1
}

# ─── Main ─────────────────────────────────────────────────────────────────────
preflight

if [[ "$MIGRATE_ONLY" == true ]]; then
  info "Migration only. Nothing will be built or restarted."
  "${COMPOSE[@]}" up -d db
  wait_healthy db
  [[ "$NO_BACKUP" == true ]] || run_backup
  run_migration
  success "Done."
  exit 0
fi

if [[ -n "$TARGET_SERVICE" ]]; then
  info "Single service: $TARGET_SERVICE"
  # A plain build, not --no-cache: rebuilding a Next.js image from scratch to
  # restart one container is both slow and, on this box, the command most likely
  # to exhaust memory.
  if [[ "$NO_BUILD" == false ]]; then
    "${COMPOSE[@]}" build "$TARGET_SERVICE"
  fi
  "${COMPOSE[@]}" up -d --no-deps "$TARGET_SERVICE"
  wait_healthy "$TARGET_SERVICE"
  success "'$TARGET_SERVICE' redeployed."
  if [[ "$TARGET_SERVICE" == "app" || "$TARGET_SERVICE" == "caddy" ]]; then
    probe_https || exit 1
  fi
  exit 0
fi

[[ "$NO_PULL" == true ]] || pull_code

# The data services come up before the backup, because pg_dump needs a live
# database — so step 4 of the sequence happens here, once, and the backup
# follows it rather than the other way round.
info "Starting data services..."
"${COMPOSE[@]}" up -d db storage
wait_healthy db
wait_healthy storage

[[ "$NO_BACKUP" == true ]] || run_backup

if [[ "$NO_BUILD" == false ]]; then
  # Free the memory the build needs. On a 2 GB box `next build` and a running
  # application do not fit, and the symptom of finding that out the hard way is
  # a bare `Killed` with no indication of which process the kernel chose.
  info "Stopping app and sweep to free memory for the build..."
  "${COMPOSE[@]}" stop app sweep 2>/dev/null || true

  info "Building $IMAGE (only changed layers rebuild)..."
  "${COMPOSE[@]}" build app || error "Build failed.
        If the last line was 'Killed' or the output simply stops, this is the OOM killer.
        Check swap:  free -m
        Then:        sudo ./scripts/ops/bootstrap-vps.sh --yes"
  success "Image built."
else
  info "Skipping the build (--no-build). Using whatever $IMAGE currently is."
fi

run_migration

info "Starting everything..."
"${COMPOSE[@]}" up -d --remove-orphans
wait_healthy app
wait_healthy caddy 6

echo ""
info "Container status:"
"${COMPOSE[@]}" ps

echo ""
PROBE_OK=true
probe_https || PROBE_OK=false

echo ""
if [[ "$PROBE_OK" == true ]]; then
  success "Deploy complete."
else
  warn "Deploy finished, but the site did not answer. See the hints above."
fi
info "  App:      https://${APP_DOMAIN}"
info "  Storage:  https://storage.${APP_DOMAIN}"
info "  Logs:     ${COMPOSE[*]} logs -f app"
[[ "$PROBE_OK" == true ]] || exit 1
