# Kali Deck

A self-hosted, password-gated **web console for a Kali Linux lab** — tool
catalog with live installs, real PTY terminals, Docker management, VPN/Tor
privacy controls, and curated runbooks — reachable from a laptop or a phone.

The deck is a thin orchestrator: it runs on the host and drives the
**kali-lab** Kali Linux container over the Docker API, so the browser never
needs a shell on the box.

> ⚠️ **Authorized use only.** This is a lab console for targets you own or
> have permission to test. The operator is responsible for complying with all
> applicable laws.

---

## One-command setup (fresh machine)

```bash
git clone https://github.com/ayush-rdev/kalideck.git
cd kalideck
bash setup.sh
```

`setup.sh` installs everything itself — Docker, Node.js, the kali-toolbox
image, the lab containers, the deck's npm dependencies, the production UI
build, and a systemd service that keeps it running. Re-run it any time; every
step is idempotent.

Useful variants:

```bash
bash setup.sh --deck-only   # web console only, no Docker image build
sudo bash setup.sh --system # system service + Tailscale HTTPS publish
```

When it finishes it prints the local URL (`http://127.0.0.1:8080/`) and the
login password (also stored in `kali-deck/.env`):

```bash
grep DECK_PASSWORD kali-deck/.env
```

On first run, if `DECK_PASSWORD` is unset the backend generates one, prints
it, and saves it to `kali-deck/.env`. Sessions are cookie-based
(`HttpOnly`, `SameSite=Strict`), last 7 days, and logins are rate-limited
(5 failures → exponential backoff up to a 5-minute lockout).

Full requirement details and manual steps: see [REQUIREMENTS.md](REQUIREMENTS.md).
Kali-lab specifics (image, TUI, tool manager): see [kali-lab/README.md](kali-lab/README.md).

---

## What you get

| Page | What it does |
|---|---|
| **Dashboard** | CPU/mem/disk/network, service health, container summary, quick links (ttyd, Homarr, Dockge, Cockpit, Tor Browser). |
| **Tools** | The whole `catalog.json` (60+ tools) grouped by category, with installed state + versions and live-streamed installs. |
| **Tool Runner** | Per-tool recipes: fill fields (target, wordlist…), preview the exact command, run it as a streaming job or open an interactive terminal. Recipes are tagged `passive`/`active`/`intrusive`. |
| **Library** | In-depth guide per tool — purpose, when to use it, the flags that matter, examples. Auto-generated entries fill the gaps. |
| **Terminals** | Real PTYs inside `kali-lab`: zsh shell, root, `kali-tui`, msfconsole, or ad-hoc commands. Server-side ring-buffered scrollback; tabs survive navigation. |
| **Docker** | Containers (start/stop/pause/kill/remove), images, Compose stacks with live log streaming. |
| **Runbooks** | Curated multi-step playbooks that open preloaded terminals / run commands. |
| **Privacy** | Tor SOCKS status + start/stop, a global "route tool runs through Tor" toggle (`proxychains4`), public-IP checks (direct + Tor egress), WireGuard tunnel up/down, ProtonVPN CLI connect/disconnect. |

All long-running work (installs, compose, log follows, ad-hoc runs) happens as
a **job** with a WebSocket stream — navigate away and come back to the same
output. The UI is a PWA: install it to your phone home screen for a
full-screen app with bottom navigation and safe-area padding. Job/terminal
WebSockets auto-reconnect and polling pauses when the tab is hidden.

---

## Architecture

```
 phone / laptop ──HTTPS──▶ Tailscale ──▶ 127.0.0.1:8080  kali-deck (this app)
                                               │
                        ┌──────────────────────┼───────────────────────┐
                        ▼                      ▼                       ▼
              Docker API (unix socket)   PTYs in kali-lab        host commands
              containers, stacks,        zsh / kali-tui /        protonvpn,
              logs, images               msfconsole / ad-hoc     /etc/resolv.conf
```

| Piece | Where | Notes |
|---|---|---|
| **kali-deck backend** | host, Node ≥ 20 | Express API + WebSocket (terminals, jobs). No DB. |
| **kali-deck UI** | `kali-deck/dist/` | React + Vite + Tailwind, served by the backend. |
| **kali-lab** | Docker container | Kali toolbox; all tools/PTYs execute here. |
| **kali-ttyd** | Docker container | `kali-tui` over HTTP on :7681 (dashboard link). |
| **Tor browser** | Docker container | noVNC desktop on :5800. |
| **VPN** | host | ProtonVPN CLI, driven from the Privacy page. |

State that matters:

- `kali-deck/.env` — `DECK_PASSWORD`, `DECK_PORT`, `DECK_HOST`, `KALI_CONTAINER`.
- `kali-deck/.deck-state.json` — the Tor-routing toggle.
- `kali-lab/catalog.json` — the tool catalog the UI renders (60+ tools).

---

## Repository layout

```
kalideck/
├── setup.sh             # one-shot automated setup (requirements + build + service)
├── REQUIREMENTS.md      # every requirement documented, with manual steps
├── kali-deck/           # the web console
│   ├── server/          # Express API, WS terminals/jobs, docker, privacy, system
│   ├── web/             # React SPA (Vite root): pages, components, PWA assets
│   ├── systemd/         # system + user service unit templates
│   ├── deploy.sh        # sudo: build + system service + Tailscale serve
│   ├── deploy-user.sh   # no sudo: build + user service
│   └── setup-sudo.sh    # protonvpn + wg-quick sudoers rules (Privacy page)
└── kali-lab/            # the Kali toolbox the deck drives
    ├── Dockerfile       # toolbox image (base image + baked toolset)
    ├── docker-compose.yml  # kali-lab + kali-ttyd services, named volumes
    ├── catalog.json     # tool catalog (single source of truth)
    ├── kalitools.py     # catalog-driven installer (apt/pipx/go/pip/gem/cargo/git/script)
    └── kali-tui         # curses front-end for kalitools
```

---

## Reaching it from other devices

The backend binds **loopback only** by default. Recommended options:

```bash
# Tailscale (HTTPS URL that works anywhere your tailnet reaches):
sudo kali-deck/setup-sudo.sh   # optional: lets the Privacy page control VPNs
sudo tailscale up
sudo kali-deck/deploy.sh       # prints https://<machine>.<tailnet>.ts.net/

# SSH tunnel (no extra software):
ssh -N -L 8080:127.0.0.1:8080 user@<server-ip>
# then open http://127.0.0.1:8080/
```

LAN access (`DECK_HOST=0.0.0.0`) is possible but exposes the login page to
everything on your Wi-Fi — read the security notes in
[REQUIREMENTS.md](REQUIREMENTS.md) first.

## Development

```bash
cd kali-deck
npm install
npm run dev        # backend on :8080
npm run dev:web    # vite on :5173, proxies /api and /ws to :8080
```

## Security model

- Everything under `/api` requires a session cookie; state-changing calls are
  additionally same-origin checked.
- The cookie is `HttpOnly; SameSite=Strict`; sessions are in-memory only
  (restart = re-login). Login throttling per client IP.
- No `--privileged` on `kali-lab`; only `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`.
- Sudo access for VPN control is **narrow**: two auditable sudoers rules
  (`protonvpn` and a `wg-*`-validating wrapper), revocable with
  `sudo rm /etc/sudoers.d/kali-deck`.
- Keep the password strong and the tailnet ACLs tight.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UI not built yet` | `cd kali-deck && npm run build` (or re-run `setup.sh`) |
| Blank page after deploy | `journalctl -u kali-deck -n 50`; confirm `dist/` exists |
| `docker api timeout` / 500s | user must be in the `docker` group; re-login |
| Terminal opens then instantly exits | container down: `docker start kali-lab` |
| Marketplace installs hang | the job needs egress from `kali-lab`; check VPN/Tor routing |
| VPN button says "sudo needs a password" | run `sudo kali-deck/setup-sudo.sh` |
| No tailnet URL printed | run `sudo tailscale up` first, then re-run `deploy.sh` |
| Service stops when you log out | `sudo loginctl enable-linger $USER` (user-service path) |

## License

[MIT](LICENSE) — use it, fork it, make it yours.
