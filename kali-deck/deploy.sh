#!/usr/bin/env bash
# deploy.sh - install Kali Deck as a systemd service and publish it on your
# tailnet over HTTPS. Idempotent: safe to re-run after every code change.
#
#   sudo kali-deck/deploy.sh
#
# What it does:
#   1. builds the SPA (npm install + vite build) as the owning user
#   2. installs /etc/systemd/system/kali-deck.service and starts it
#   3. makes the owning user a Tailscale operator and runs `tailscale serve`
#      so https://<machine>.<tailnet>.ts.net/ proxies to 127.0.0.1:8080
#
# Nothing is exposed to the LAN: the deck keeps binding loopback only, and
# Tailscale terminates TLS on the tailnet.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run me with sudo:  sudo $0" >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME=kali-deck
# The port the backend binds and Tailscale proxies to.
DECK_PORT="${DECK_PORT:-8080}"
# Bind address. 0.0.0.0 exposes the deck on your LAN - see the README first.
DECK_HOST="${DECK_HOST:-127.0.0.1}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TEMPLATE="${REPO}/systemd/${SERVICE_NAME}.service.in"

# ---------------------------------------------------------------- identity ---
TARGET_USER="${DECK_USER:-${SUDO_USER:-server}}"
if ! id "$TARGET_USER" >/dev/null 2>&1; then
  echo "unknown user: $TARGET_USER (override with DECK_USER=...)" >&2
  exit 1
fi
TARGET_GROUP="$(id -gn "$TARGET_USER")"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
[[ -n "$TARGET_HOME" ]] || TARGET_HOME="/home/${TARGET_USER}"

NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH" >&2; exit 1; }
NODE_BIN="$(readlink -f "$NODE_BIN")"

[[ -f "$TEMPLATE" ]] || { echo "missing unit template: $TEMPLATE" >&2; exit 1; }

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

# ------------------------------------------------------------------- build ---
# Run the build as the owning user so node_modules/dist never end up root-owned.
as_user() {
  runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" PATH="$PATH" bash -c "$1"
}

say "building UI as ${TARGET_USER}"
if [[ ! -d "${REPO}/node_modules" ]]; then
  as_user "cd '$REPO' && npm install --no-audit --no-fund"
fi
as_user "cd '$REPO' && npm run build"

# ------------------------------------------------------------------ service --
say "installing ${UNIT_FILE}"
sed \
  -e "s|__USER__|${TARGET_USER}|g" \
  -e "s|__GROUP__|${TARGET_GROUP}|g" \
  -e "s|__DIR__|${REPO}|g" \
  -e "s|__NODE__|${NODE_BIN}|g" \
  -e "s|__PORT__|${DECK_PORT}|g" \
  -e "s|__HOST__|${DECK_HOST}|g" \
  "$TEMPLATE" >"$UNIT_FILE"
chmod 0644 "$UNIT_FILE"

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"
sleep 1
systemctl --no-pager --lines=6 status "${SERVICE_NAME}.service" || true

# ------------------------------------------------------------------ health ---
say "checking the backend on 127.0.0.1:${DECK_PORT}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 3 "http://127.0.0.1:${DECK_PORT}/api/health" >/dev/null 2>&1; then
    echo "    backend is healthy"
    break
  fi
  sleep 1
  if [[ $_ -eq 10 ]]; then
    echo "    !! backend never became healthy - see: journalctl -u ${SERVICE_NAME} -n 50" >&2
  fi
done

# ----------------------------------------------------------------- tailscale --
if ! command -v tailscale >/dev/null 2>&1; then
  say "tailscale not installed - skipping tailnet publish"
  echo "    install from https://tailscale.com/download, then re-run this script."
  echo "    (the deck is already running and reachable via an SSH tunnel in the meantime)"
  exit 0
fi

say "configuring Tailscale"
tailscale set --operator="$TARGET_USER" >/dev/null 2>&1 || true

if ! tailscale status >/dev/null 2>&1; then
  echo "    tailscale is not up yet. Log in first, then re-run this script:"
  echo
  echo "        sudo tailscale up"
  echo
  exit 0
fi

# HTTPS on :443 -> the loopback backend. --bg keeps it running headless.
# `tailscale serve` prints a link and then BLOCKS when Serve is not yet
# enabled for the tailnet, so always run it under a timeout.
SERVE_OUT="$(timeout 20 tailscale serve --bg --https=443 "http://127.0.0.1:${DECK_PORT}" 2>&1)" || true
if grep -qi 'not enabled' <<<"$SERVE_OUT"; then
  echo
  echo "    !! Tailscale Serve is not enabled on your tailnet yet."
  echo "       Open this once, then re-run deploy.sh:"
  echo
  grep -oE 'https://login\.tailscale\.com/[^[:space:]]+' <<<"$SERVE_OUT" | sed 's/^/         /'
  echo
  exit 0
fi
if ! tailscale serve status >/dev/null 2>&1; then
  timeout 20 tailscale serve --bg "${DECK_PORT}" >/dev/null 2>&1 || true
fi

HOSTNAME_TS="$(tailscale status --json 2>/dev/null | grep -o '"DNSName"[^,]*' | head -1 | sed -E 's/.*"DNSName": *"([^"]+)".*/\1/' | sed 's/\.$//')"

say "done"
if [[ "$DECK_HOST" == "0.0.0.0" ]]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "    LAN URL:   http://${LAN_IP:-<server-ip>}:${DECK_PORT}/"
fi
echo "    deck URL:  https://${HOSTNAME_TS:-<machine>.<tailnet>.ts.net}/"
echo "    password:  stored in ${REPO}/.env (DECK_PASSWORD)"
echo
echo "    logs:      journalctl -u ${SERVICE_NAME} -f"
echo "    stop:      sudo systemctl stop ${SERVICE_NAME}"
echo
echo "    Install it to your phone home screen (Share -> Add to Home Screen)"
echo "    for a full-screen, app-like console."
