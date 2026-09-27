#!/usr/bin/env bash
# setup.sh - one-shot bootstrap for Kali Deck + Kali Lab on a fresh machine.
#
#   bash setup.sh              # full setup (system deps + image + container + deck)
#   bash setup.sh --deck-only  # just the web console (skips docker image build)
#
# What it does:
#   1. installs system requirements (docker, node >= 20, python3, curl, tailscale[opt])
#   2. builds the kali-toolbox image and starts the kali-lab + kali-ttyd stack
#   3. installs the deck's node deps, builds the UI, and starts the service
#      (systemd user service by default, system service + Tailscale with --system)
#
# Safe to re-run at any time; every step is idempotent.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECK_DIR="$here/kali-deck"
LAB_DIR="$here/kali-lab"

DECK_ONLY=0
SYSTEM_MODE=0
for arg in "$@"; do
  case "$arg" in
    --deck-only) DECK_ONLY=1 ;;
    --system)    SYSTEM_MODE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. system deps
# Best effort per distro: apt (Debian/Kali/Ubuntu) only. On other distros we
# verify the tools exist and point you at the package manager otherwise.
SUDO=""
[[ $EUID -eq 0 ]] || SUDO="sudo"

apt_install() {
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -y
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

say "checking system requirements"

# --- docker (required unless --deck-only) ---
if [[ $DECK_ONLY -eq 0 ]]; then
  if ! have docker; then
    say "installing docker"
    if have apt-get; then
      apt_install ca-certificates curl gnupg
      $SUDO install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
        | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
      apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    else
      die "docker is required: install it from https://docs.docker.com/engine/install/ then re-run"
    fi
  fi
  if ! docker info >/dev/null 2>&1; then
    say "adding your user to the docker group"
    $SUDO usermod -aG docker "$USER" || true
    info "group added - log out/in once so it sticks without sudo"
    if $SUDO docker info >/dev/null 2>&1; then
      d() { $SUDO docker "$@"; }
    else
      die "docker is installed but not usable yet - log out and back in, then re-run setup.sh"
    fi
  else
    d() { docker "$@"; }
  fi
  d compose version >/dev/null 2>&1 || die "docker compose plugin missing (install docker-compose-plugin) and re-run"
fi

# --- node >= 20 (required) ---
node_ok() {
  have node || return 1
  local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 20 ]]
}
if ! node_ok; then
  say "installing node.js (v20 LTS from nodesource)"
  if have apt-get; then
    apt_install ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | ${SUDO:+$SUDO -E}bash -
    apt_install nodejs
    node_ok || die "node >= 20 still missing; install it manually from https://nodejs.org"
  else
    die "node >= 20 is required: install from https://nodejs.org then re-run"
  fi
fi
info "node $(node -v), npm $(npm -v)"

have curl || apt_install curl
have git   || apt_install git

# ------------------------------------------------------- 2. lab image + stack
if [[ $DECK_ONLY -eq 0 ]]; then
  say "building the kali-toolbox image (this can take a while)"
  if $DOCKER image inspect kali-saved >/dev/null 2>&1; then
    info "kali-saved found locally - using it as the base (full pre-baked toolset)"
  else
    info "kali-saved not found - building on kalilinux/kali-rolling (tools install at build time)"
  fi
  base="kalilinux/kali-rolling"
  d image inspect kali-saved >/dev/null 2>&1 && base="kali-saved"
  d build --build-arg "KALI_BASE=$base" -t kali-toolbox:latest "$LAB_DIR"

  say "starting the kali-lab stack (kali-lab + kali-ttyd)"
  ( cd "$LAB_DIR" && d compose up -d )
  d start kali-lab >/dev/null 2>&1 || true
  info "verify:  docker exec -it -u hacker kali-lab /bin/zsh   (then run: kali-tui)"
fi

# ------------------------------------------------------------- 3. the deck
say "installing deck dependencies + building the UI"
( cd "$DECK_DIR" && npm install --no-audit --no-fund && npm run build )

say "starting the web console"
if [[ $SYSTEM_MODE -eq 1 ]] && [[ $EUID -eq 0 ]]; then
  exec "$DECK_DIR/deploy.sh"
else
  exec "$DECK_DIR/deploy-user.sh"
fi
