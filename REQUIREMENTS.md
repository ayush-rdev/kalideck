# Requirements

What a machine needs to run Kali Deck, what `setup.sh` does about it, and
the manual equivalent of every step. The VPN/Tor layers and their one-time
configuration are covered at the end.

## Host requirements

| Requirement | Minimum | Notes | Auto-installed |
|---|---|---|---|
| OS | Debian / Ubuntu / Kali | systemd + bash; other distros work but `setup.sh` only automates apt | — |
| Docker Engine | 20.10+ with compose plugin | runs `kali-lab`, `kali-ttyd`, `tor-browser` | yes |
| Node.js | 20+ | backend runtime and UI build | yes |
| Python 3 | 3.11+ | only inside the container; the Kali base ships it | via base image |
| Disk | ~5 GB | 15–20 GB with a pre-baked base image; named volumes grow with use | — |
| RAM | 2 GB | the deck itself is a lightweight Node process | — |
| Tailscale | optional | publishes the deck over HTTPS on your tailnet | no |
| WireGuard | optional | Privacy page tunnel up/down | no |
| ProtonVPN CLI | optional | community `protonvpn-cli` via pipx | no |

The deck has no database. Its state is `kali-deck/.env` and
`kali-deck/.deck-state.json`.

JS dependencies (`kali-deck/package.json`), installed by `npm install`:
express 5, ws 8, react 19, `@xterm/xterm`; build tooling is vite 8 and
tailwindcss 4. The Python tooling in `kali-lab` is stdlib-only.

## The privacy stack

The Privacy page drives three independent layers. All are optional; the deck
works without any of them.

**WireGuard.** The deck reads interface names and up-state from
`/sys/class/net` and toggles tunnels through `wg-quick`. Keys never leave the
kernel. One-time setup: install `wireguard-tools`, put your provider's
config at `/etc/wireguard/wg-<name>.conf`, then run
`sudo kali-deck/setup-sudo.sh` so the buttons work without a password.

**ProtonVPN.** The community `protonvpn-cli` drives OpenVPN. One-time setup:
`pipx install protonvpn-cli && protonvpn init`. Independent of WireGuard —
the page shows both, and both can be up at once.

**Tor.** The `tor` daemon runs inside `kali-lab` (host networking, so its
SOCKS port is `127.0.0.1:9050` on the host). The deck can start and stop it,
wrap tool runs in `proxychains4`, and show your direct and Tor egress IPs.
`tor` and `proxychains4` are baked into the image; nothing to configure. The
Tor Browser container serves a noVNC desktop on `127.0.0.1:5800`.

The sudoers rules from `setup-sudo.sh` are two narrow, auditable entries.
Revoke with `sudo rm /etc/sudoers.d/kali-deck /usr/local/sbin/kali-deck-wg`.

## What setup.sh does

| Step | Action | Idempotent |
|---|---|---|
| 1 | Install Docker Engine + compose plugin (docker.com apt repo) | skips if present |
| 2 | Add your user to the `docker` group | skips if the socket already works |
| 3 | Install Node.js 20 (nodesource) if missing or older | skips if present |
| 4 | Build `kali-toolbox:latest`; uses local `kali-saved` as base when available, else `kalilinux/kali-rolling` | Docker layer cache |
| 5 | `docker compose up -d` for `kali-lab`, `kali-ttyd`, `tor-browser` | reuses running containers |
| 6 | `npm install` + `npm run build` in `kali-deck/` | incremental |
| 7 | Start the systemd user service, or the system service + Tailscale Serve with `--system` | re-runnable |

Flags: `--deck-only` (steps 1–3 if missing, then 6–7), `--system` (full
setup + system service + Tailscale), `--help`.

## Manual setup

Docker and the lab:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker

cd kali-lab
docker build -t kali-toolbox:latest .    # add --build-arg KALI_BASE=kalilinux/kali-rolling on a fresh box
docker compose up -d
docker exec -it -u hacker kali-lab /bin/zsh   # then run kali-tui
```

The compose file reads `TTYD_USER` / `TTYD_PASSWORD` from `kali-lab/.env`
(default `changeme` — set real values before exposing :7681 anywhere).

The deck:

```bash
cd kali-deck
npm install
npm run build          # emits dist/, served by the backend
npm start              # http://127.0.0.1:8080

# or as a service:
./deploy-user.sh       # systemd user service, no sudo
sudo ./deploy.sh       # system service + Tailscale Serve
```

LAN exposure binds the login page to your network. Prefer Tailscale or an
SSH tunnel; if you still want it, `sudo DECK_HOST=0.0.0.0 ./deploy.sh` and
fence the port with ufw.

## Configuration

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DECK_PASSWORD` | `kali-deck/.env` | generated on first run | login password |
| `DECK_PORT` | `kali-deck/.env` | `8080` | backend listen port |
| `DECK_HOST` | `kali-deck/.env` | `127.0.0.1` | bind address; `0.0.0.0` = LAN |
| `KALI_CONTAINER` | `kali-deck/.env` | `kali-lab` | container the deck drives |
| `KALI_BASE` | docker build arg | `kali-saved` → `kalilinux/kali-rolling` | base image for the toolbox |
| `KALITOOLS_SKIP_INSTALL` | docker build arg | `0` | `1` builds a base-only image without the tool bake |
| `TTYD_USER` / `TTYD_PASSWORD` | `kali-lab/.env` | `server` / `changeme` | ttyd web-terminal credentials |

Sessions live in memory; a service restart means logging in again.

## Verify

```bash
docker exec -it -u hacker kali-lab kali-tui --help
curl -s http://127.0.0.1:8080/api/health          # {"ok":true,...}
systemctl --user status kali-deck                 # or: systemctl status kali-deck
grep DECK_PASSWORD kali-deck/.env                 # then log in at :8080
```
