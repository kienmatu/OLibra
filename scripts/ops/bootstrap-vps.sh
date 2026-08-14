#!/usr/bin/env bash
# bootstrap-vps.sh — Prepare a fresh Ubuntu host to run OLibra.
#
# Usage: sudo ./scripts/ops/bootstrap-vps.sh --yes [--user <name>] [--no-firewall]
#
# Options:
#   --yes           Actually make the changes. Without it, the plan is printed
#                   and nothing happens.
#   --user <name>   The unprivileged user to create (default: deploy).
#   --no-firewall   Skip the ufw section. Use this if the provider already runs
#                   a firewall in front of the machine, or if you are on a
#                   console where locking yourself out is not recoverable.
#
# Run once, as root, on a fresh Ubuntu 22.04 or 24.04 host — before the
# repository is cloned. Idempotent: running it twice changes nothing the second
# time.
#
# ── What it does, and why each part is here ───────────────────────────────────
#
#   1. An unprivileged `deploy` user in the docker group. Nothing about running
#      this application needs root.
#   2. Docker Engine and the compose plugin, from Docker's own apt repository —
#      Ubuntu's `docker.io` package lags and has shipped without the compose
#      plugin, which every script in this repository assumes.
#   3. **A 2 GB swapfile.** deploy.sh's preflight refuses to build without it.
#      `next build` peaks near 2 GB while Postgres and MinIO already hold about
#      400 MB, and on a 2 GB box the two do not fit. Swap is slow, and that is
#      fine — the alternative is not "slower", it is the OOM killer removing
#      the build with no message.
#   4. Docker log rotation. The default json-file driver grows without bound,
#      and a full disk on a box with no monitoring is discovered by the site
#      going down.
#   5. fail2ban and unattended-upgrades. The machine is on the public internet
#      with an SSH port open.
#   6. The timezone, matching the TZ every service in compose.prod.yaml sets.
#   7. The nightly backup cron entry.
#   8. ufw, **last**, so a mistake in an earlier step does not happen behind a
#      firewall that is already closed.
#
# ── What it deliberately does NOT do ──────────────────────────────────────────
#
# It does not create .env.prod and it does not generate secrets. Writing
# passwords from a script means they exist in a shell history and in a script
# log; generate them by hand and paste them in. docs/DEPLOYMENT.md has the
# commands.

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${CYAN}━━━${NC} $* ${CYAN}━━━${NC}"; }

CONFIRMED=false
DEPLOY_USER="deploy"
DO_FIREWALL=true
SWAP_FILE="/swapfile"
SWAP_SIZE="2G"
APP_DIR_HINT="/home/\$USER/olibra"

while [[ $# -gt 0 ]]; do
  case $1 in
    --yes)          CONFIRMED=true; shift ;;
    --user)         DEPLOY_USER="${2:-}"; [[ -n "$DEPLOY_USER" ]] || error "--user needs a value."; shift 2 ;;
    --no-firewall)  DO_FIREWALL=false; shift ;;
    -h|--help)      sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              error "Unknown option: $1" ;;
  esac
done

# ─── The plan ─────────────────────────────────────────────────────────────────
# Printed before the root check, deliberately. This script installs packages,
# edits /etc/fstab and closes a firewall on a machine that may be reachable only
# through that firewall — so the one thing it must always allow is reading what
# it intends to do *before* being handed root. Refusing to print the plan until
# the reader has already sudo'd gets the order exactly backwards.
cat <<EOF

This will change the following on $(hostname):

  1. Create user '$DEPLOY_USER' (in the docker group), if absent
  2. Install Docker Engine + compose plugin from Docker's apt repository
  3. Create a ${SWAP_SIZE} swapfile at ${SWAP_FILE} and add it to /etc/fstab
     Set vm.swappiness=10 in /etc/sysctl.d/
  4. Write /etc/docker/daemon.json with log rotation (10m x 3 per container)
  5. Install and enable fail2ban and unattended-upgrades
  6. Set the timezone to Asia/Ho_Chi_Minh
  7. Install a nightly backup cron entry at 03:00 for '$DEPLOY_USER'
$(if [[ "$DO_FIREWALL" == true ]]; then
echo "  8. Configure ufw: allow 22, 80, 443; deny everything else; enable it"
else
echo "  8. SKIPPED (--no-firewall)"
fi)

It does NOT create .env.prod or generate any secret. Do that by hand.

EOF

if [[ "$CONFIRMED" != true ]]; then
  warn "Nothing has been changed. Re-run with --yes to proceed:"
  warn "  sudo $0 --yes"
  exit 1
fi

# Root, now that something is actually about to change. Every step below writes
# somewhere only root can write.
[[ "$EUID" -eq 0 ]] || error "This must be run as root. Try: sudo $0 $*"

if [[ "$DO_FIREWALL" == true ]]; then
  warn "Step 8 enables a firewall allowing only ports 22, 80 and 443."
  warn "If you connect over SSH on a port other than 22, you will be locked out."
  warn "Use --no-firewall, or add your port to the ufw section by hand, first."
  read -r -p "Continue? [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || error "Stopped. Nothing has been changed."
fi

export DEBIAN_FRONTEND=noninteractive

# ─── 1. The deploy user ───────────────────────────────────────────────────────
step "1/8  User"
if id -u "$DEPLOY_USER" &>/dev/null; then
  success "User '$DEPLOY_USER' already exists."
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  success "Created '$DEPLOY_USER'."
  # Carry root's authorised keys across, or the new user cannot log in and the
  # firewall in step 8 makes that permanent.
  if [[ -f /root/.ssh/authorized_keys ]]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
    success "Copied root's authorized_keys to '$DEPLOY_USER'."
  else
    warn "No /root/.ssh/authorized_keys to copy. Set up key access for '$DEPLOY_USER' BEFORE step 8."
  fi
fi

# ─── 2. Docker ────────────────────────────────────────────────────────────────
step "2/8  Docker"
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  success "Docker and the compose plugin are already installed."
else
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  success "Docker installed: $(docker --version)"
fi
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker >/dev/null 2>&1 || true
success "'$DEPLOY_USER' is in the docker group."

# ─── 3. Swap ──────────────────────────────────────────────────────────────────
step "3/8  Swap"
if swapon --show | grep -q "$SWAP_FILE"; then
  success "Swap is already active: $(swapon --show --noheadings --bytes | awk '{print $3}' | head -1) bytes"
else
  if [[ ! -f "$SWAP_FILE" ]]; then
    # fallocate is instant; dd is the fallback for filesystems that refuse it.
    fallocate -l "$SWAP_SIZE" "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=none
  fi
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  success "Swapfile active: $SWAP_SIZE at $SWAP_FILE"
fi
grep -q "^${SWAP_FILE}[[:space:]]" /etc/fstab || {
  echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  success "Swapfile persisted in /etc/fstab."
}
# 10 rather than the default 60: swap is here as a ceiling for the build, not
# as somewhere to page the running application out to.
echo "vm.swappiness=10" > /etc/sysctl.d/99-olibra-swappiness.conf
sysctl -q -w vm.swappiness=10
success "vm.swappiness=10"

# ─── 4. Docker log rotation ───────────────────────────────────────────────────
step "4/8  Docker log rotation"
# The json-file driver's default is unbounded. The `sweep` service prints a line
# every day, `caddy` prints one per request, and a full disk on an unmonitored
# box is discovered by the site going down.
if [[ -f /etc/docker/daemon.json ]] && grep -q "max-size" /etc/docker/daemon.json; then
  success "Log rotation is already configured."
else
  mkdir -p /etc/docker
  [[ -f /etc/docker/daemon.json ]] && cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak-$(date -u +%Y%m%d%H%M%S)"
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
  systemctl restart docker
  success "Log rotation: 10m x 3 per container."
fi

# ─── 5. fail2ban and unattended-upgrades ──────────────────────────────────────
step "5/8  fail2ban and unattended-upgrades"
apt-get install -y -qq fail2ban unattended-upgrades
systemctl enable --now fail2ban >/dev/null 2>&1 || true
# Enables the security-updates origin without an interactive prompt.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
success "fail2ban running; unattended security upgrades enabled."

# ─── 6. Timezone ──────────────────────────────────────────────────────────────
step "6/8  Timezone"
timedatectl set-timezone Asia/Ho_Chi_Minh
success "Timezone: $(timedatectl show -p Timezone --value)"

# ─── 7. Nightly backup ────────────────────────────────────────────────────────
step "7/8  Nightly backup"
# Host cron rather than a compose service, unlike `sweep`: `sweep` is
# application behaviour and belongs with the application, whereas a backup
# should not stop happening because the stack it backs up was redeployed. It
# does need a live database, so a failure while the stack is down is expected —
# and cron mails it, which is the notification.
CRON_LINE="0 3 * * * cd \$HOME/olibra && ./scripts/ops/backup.sh --quiet"
CURRENT=$(crontab -u "$DEPLOY_USER" -l 2>/dev/null || true)
if grep -qF "backup.sh" <<<"$CURRENT"; then
  success "A backup cron entry already exists for '$DEPLOY_USER'."
else
  printf '%s\n%s\n' "$CURRENT" "$CRON_LINE" | sed '/^$/d' | crontab -u "$DEPLOY_USER" -
  success "Nightly backup at 03:00 for '$DEPLOY_USER'."
  warn "It assumes the repository is at ${APP_DIR_HINT}. Edit with: crontab -u $DEPLOY_USER -e"
fi

# ─── 8. Firewall, last ────────────────────────────────────────────────────────
step "8/8  Firewall"
if [[ "$DO_FIREWALL" != true ]]; then
  warn "Skipped (--no-firewall). Nothing is restricting inbound traffic from this script."
else
  apt-get install -y -qq ufw
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp  >/dev/null   # SSH
  ufw allow 80/tcp  >/dev/null   # ACME challenge and the HTTP->HTTPS redirect
  ufw allow 443/tcp >/dev/null   # HTTPS
  ufw allow 443/udp >/dev/null   # HTTP/3
  ufw --force enable >/dev/null
  success "ufw enabled: 22, 80, 443 in; everything else denied."
  ufw status numbered
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
cat <<EOF

$(success "Host prepared.")

Next, as '$DEPLOY_USER' rather than root:

  1. Log out and back in, so the docker group membership takes effect:
       ssh $DEPLOY_USER@$(hostname -I 2>/dev/null | awk '{print $1}')

  2. Clone the repository:
       git clone <repo-url> ~/olibra && cd ~/olibra

  3. Create .env.prod and fill in every secret:
       cp .env.prod.example .env.prod
       openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo   # once per secret

  4. Point two DNS A records at $(hostname -I 2>/dev/null | awk '{print $1}'):
       <your-domain>           A   $(hostname -I 2>/dev/null | awk '{print $1}')
       storage.<your-domain>   A   $(hostname -I 2>/dev/null | awk '{print $1}')

  5. Deploy:
       ./deploy.sh --domain <your-domain>

docs/DEPLOYMENT.md walks all of it in full.

EOF
