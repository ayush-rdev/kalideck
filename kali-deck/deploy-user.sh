#!/usr/bin/env bash
# deploy-user.sh - run Kali Deck as a systemd *user* service. No sudo needed.
#
#   kali-deck/deploy-user.sh
#
# Good for: trying it out now, and dev boxes where you own the account.
# For a durable, boot-time service use `sudo kali-deck/deploy.sh` instead
# (or enable lingering, see the note it prints at the end).
#
# The backend still binds 127.0.0.1 only. Reach it with an SSH tunnel today,
# and over Tailscale once you run the sudo steps in the README.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/kali-deck.service"
TEMPLATE="${REPO}/systemd/kali-deck.user.service.in"
DECK_PORT="${DECK_PORT:-8080}"

NODE_BIN="$(readlink -f "$(command -v node || true)")"
[[ -n "$NODE_BIN" ]] || { echo "node not found on PATH" >&2; exit 1; }
[[ -f "$TEMPLATE" ]] || { echo "missing unit template: $TEMPLATE" >&2; exit 1; }

say() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

say "building UI"
if [[ ! -d "${REPO}/node_modules" ]]; then
  (cd "$REPO" && npm install --no-audit --no-fund)
fi
(cd "$REPO" && npm run build)

say "installing user unit ${UNIT_FILE}"
mkdir -p "$UNIT_DIR"
sed \
  -e "s|__DIR__|${REPO}|g" \
  -e "s|__NODE__|${NODE_BIN}|g" \
  -e "s|__PORT__|${DECK_PORT}|g" \
  "$TEMPLATE" >"$UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now kali-deck.service
sleep 1
systemctl --user --no-pager --lines=5 status kali-deck.service || true

say "health check on 127.0.0.1:${DECK_PORT}"
ok=no
for _ in $(seq 1 10); do
  if curl -fsS -m 3 "http://127.0.0.1:${DECK_PORT}/api/health" >/dev/null 2>&1; then
    echo "    backend is healthy"
    ok=yes
    break
  fi
  sleep 1
done
[[ "$ok" == yes ]] || echo "    !! not healthy - see: journalctl --user -u kali-deck -n 50" >&2

say "done - it is running now"
echo "    local URL:  http://127.0.0.1:${DECK_PORT}/"
echo "    password:   grep DECK_PASSWORD ${REPO}/.env"
echo
echo "    Keep it alive after you log out (survives SSH disconnect + reboots):"
echo "        sudo loginctl enable-linger $USER"
echo
echo "    Reach it from this machine's LAN / phone right now with an SSH tunnel:"
echo "        ssh -N -L ${DECK_PORT}:127.0.0.1:${DECK_PORT} ${USER}@<server-ip>"
echo "      then open  http://127.0.0.1:${DECK_PORT}/  on the device"
echo
echo "    For a proper HTTPS URL on your tailnet instead (needs sudo once):"
echo "        sudo tailscale up"
echo "        sudo kali-deck/deploy.sh"
