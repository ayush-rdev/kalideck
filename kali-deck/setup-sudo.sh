#!/usr/bin/env bash
# setup-sudo.sh - let the Kali Deck UI control the VPN without a password.
#
# Installs two narrow privileges:
#   * `sudo -n protonvpn ...`          - Privacy page connect/disconnect
#   * `sudo -n kali-deck-wg up|down <iface>` - WireGuard tunnel toggle
#
#   sudo kali-deck/setup-sudo.sh
#
# To undo:  sudo rm /etc/sudoers.d/kali-deck /usr/local/sbin/kali-deck-wg
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "run me with sudo:  sudo $0" >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-${DECK_USER:-}}"
if [[ -z "$TARGET_USER" ]]; then
  echo "cannot determine the target user - pass DECK_USER=<name>" >&2
  exit 1
fi
if ! id "$TARGET_USER" >/dev/null 2>&1; then
  echo "unknown user: $TARGET_USER" >&2
  exit 1
fi

RULE_FILE=/etc/sudoers.d/kali-deck
WRAPPER=/usr/local/sbin/kali-deck-wg
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "# Managed by kali-deck/setup-sudo.sh - lets the deck UI drive the VPN."
  echo "# Remove this file to revoke: sudo rm $RULE_FILE"
} >"$TMP"

added=0

# --- ProtonVPN CLI -----------------------------------------------------------
PROTONVPN="$(command -v protonvpn || true)"
if [[ -n "$PROTONVPN" ]]; then
  PROTONVPN="$(readlink -f "$PROTONVPN")"
  echo "$TARGET_USER ALL=(root) NOPASSWD: $PROTONVPN" >>"$TMP"
  echo "  + protonvpn       ->  $PROTONVPN"
  added=$((added + 1))
else
  echo "  - protonvpn CLI not found, skipping that rule" >&2
fi

# --- WireGuard ---------------------------------------------------------------
# sudoers forbids wildcards in command arguments, so the interface-name check
# lives in a root-owned wrapper instead. /etc/wireguard is root-owned too, so
# a non-root user cannot smuggle PostUp code into a tunnel config.
WG_QUICK="$(command -v wg-quick || true)"
if [[ -n "$WG_QUICK" ]]; then
  WG_QUICK="$(readlink -f "$WG_QUICK")"
  cat >"$WRAPPER" <<EOF
#!/bin/sh
# Managed by kali-deck/setup-sudo.sh. Runs wg-quick for wg-* tunnels only.
set -eu
verb="\${1:-}"
name="\${2:-}"
case "\$verb" in
  up|down) ;;
  *) echo "usage: kali-deck-wg up|down <iface>" >&2; exit 2 ;;
esac
case "\$name" in
  wg-*) ;;
  *) echo "refusing: interface must start with wg-" >&2; exit 2 ;;
esac
printf '%s' "\$name" | grep -Eq '^wg-[A-Za-z0-9._-]+\$' || {
  echo "refusing: invalid interface name" >&2; exit 2
}
exec $WG_QUICK "\$verb" "\$name"
EOF
  chown root:root "$WRAPPER"
  chmod 0755 "$WRAPPER"
  echo "$TARGET_USER ALL=(root) NOPASSWD: $WRAPPER" >>"$TMP"
  echo "  + kali-deck-wg    ->  $WRAPPER (validates wg-* names)"
  added=$((added + 1))
else
  echo "  - wg-quick not found, skipping that rule" >&2
fi

if [[ $added -eq 0 ]]; then
  echo "nothing to install - neither protonvpn nor wg-quick is on PATH" >&2
  exit 1
fi

# visudo -c validates syntax before the file can ever lock you out of sudo.
if ! visudo -cf "$TMP" >/dev/null; then
  echo "refusing to install: generated sudoers file failed validation" >&2
  exit 1
fi

install -m 0440 -o root -g root "$TMP" "$RULE_FILE"
echo
echo "installed $RULE_FILE for user '$TARGET_USER'"
echo "verify:  sudo -n -l | grep -E 'protonvpn|kali-deck-wg'"
