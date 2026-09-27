# Kali Deck

A self-hosted web console for the **kali-lab** cyber range on this server.
One password-gated UI that gives you the tool catalog, real PTY terminals,
Docker/stack management, privacy toggles (Tor + ProtonVPN) and ready-made
runbooks — from a laptop or a phone.

It is a thin orchestrator: the deck runs on the host and drives the
`kali-lab` container over the Docker API, so the browser never needs a
shell on the box.

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
| **kali-deck UI** | `dist/` | React + Vite + Tailwind, served by the backend. |
| **kali-lab** | Docker container | Kali toolbox; all tools/PTYs execute here. |
| **kali-ttyd** | Docker container | `kali-tui` over HTTP on :7681 (dashboard link). |
| **Tor browser** | Docker container | noVNC desktop on :5800. |
| **VPN** | host | ProtonVPN CLI, driven from the Privacy page. |

State that matters:

- `kali-deck/.env` — `DECK_PASSWORD`, `DECK_PORT`, `DECK_HOST`, `KALI_CONTAINER`.
- `kali-deck/.deck-state.json` — the Tor-routing toggle.
- `kali-lab/catalog.json` — the tool catalog the UI renders.

---

## Quick start

No sudo needed — this installs a systemd **user** service and starts it now:

```bash
kali-deck/deploy-user.sh
```

Then read the password and open the URL it prints (`http://127.0.0.1:8080/`):

```bash
grep DECK_PASSWORD kali-deck/.env
```

Foreground, for hacking on it:

```bash
cd kali-deck
npm install
npm run build          # emits dist/
npm start              # http://127.0.0.1:8080
```

For UI development with hot reload:

```bash
npm run dev            # backend on :8080
npm run dev:web        # vite on :5173, proxies /api and /ws to :8080
```

### Password

On first run, if `DECK_PASSWORD` is unset the backend generates one and
prints it *and* writes it into `kali-deck/.env`. Read it back any time:

```bash
grep DECK_PASSWORD kali-deck/.env
```

Sessions are cookie-based (`HttpOnly`, `SameSite=Strict`) and last 7 days.
Logins are rate-limited: 5 failures triggers a backoff that doubles to a
5-minute lockout.

---

## Deploy as a service + reach it from your phone

The recommended shape is **loopback backend + Tailscale Serve** — the deck
never listens on your LAN, and you get a real HTTPS URL that works from
anywhere your tailnet reaches, no port forwarding.

```bash
# one-time
sudo kali-deck/setup-sudo.sh     # lets the Privacy page control ProtonVPN
sudo tailscale up                # log in to your tailnet (if not already)

# install / upgrade
sudo kali-deck/deploy.sh
```

`deploy.sh` is idempotent — re-run it after any code change. It:

1. builds the UI as the owning user,
2. installs and (re)starts `kali-deck.service`,
3. sets the Tailscale operator and runs
   `tailscale serve --bg --https=443 http://127.0.0.1:8080`,
4. prints your `https://<machine>.<tailnet>.ts.net/` URL.

Then on your phone: open that URL, sign in, and use **Share → Add to Home
Screen**. The PWA manifest gives you a standalone, full-screen app with the
bottom navigation bar and safe-area padding baked in.

### LAN access (http://<server-ip>:8080)

Binds every interface instead of loopback. This box has other services and
**no firewall enabled**, so anything on the Wi-Fi can reach the login page.

```bash
sudo DECK_HOST=0.0.0.0 kali-deck/deploy.sh
```

Or flip an already-running service in place:

```bash
sudo sed -i 's|^Environment=DECK_HOST=.*|Environment=DECK_HOST=0.0.0.0|' \
  /etc/systemd/system/kali-deck.service
sudo systemctl daemon-reload && sudo systemctl restart kali-deck
```

Go back to loopback-only with `DECK_HOST=127.0.0.1`. Binding `0.0.0.0` still
works with Tailscale Serve (it proxies to `127.0.0.1`), so you can turn both on.

To restrict the LAN surface while keeping it reachable, allow only your
subnet and Tailscale with ufw:

```bash
sudo ufw allow from 192.168.31.0/24 to any port 8080 proto tcp
sudo tailscale up   # tailnet traffic is trusted by ufw's default rules
sudo ufw enable
```

Or skip all of that and use an SSH tunnel:
`ssh -N -L 8080:127.0.0.1:8080 <user>@<server-ip>`.

### Enabling the VPN UI

`connect` / `disconnect` from the Privacy page need:

```bash
sudo kali-deck/setup-sudo.sh
```

It installs two **narrow** rules in `/etc/sudoers.d/kali-deck`:

```
server ALL=(root) NOPASSWD: /usr/local/bin/protonvpn
server ALL=(root) NOPASSWD: /usr/bin/wg-quick up wg-*, /usr/bin/wg-quick down wg-*
```

Revoke any time with `sudo rm /etc/sudoers.d/kali-deck`. If a rule is
missing the panel says `sudo needs a password`, and you can still drive the
VPN from a terminal.

### Which VPN is actually running?

There are two independent things here, and the Privacy page shows both:

- **WireGuard** — a live tunnel shows as `wg-<cc>-<tier>-<n>` (e.g.
  `wg-MX-FREE-11`). The deck reads interface names + up-state from
  `/sys/class/net` (no root needed) and can bring them up/down with the
  sudoers rule above. **Keys never leave the kernel** — only names and
  state are read.
- **ProtonVPN CLI** — `protonvpn` on this box is the community
  `protonvpn-cli` (pipx), which drives OpenVPN (UDP/TCP). Note it is a
  *different* tool from whatever brought the WireGuard tunnel up, and its
  API only exposes OpenVPN protocols. If it reports `not initialized`, the
  deck can't connect through it until you run `protonvpn init` once.

---

## What's in the UI

- **Dashboard** — CPU/mem/disk/network, service health, container summary,
  quick links to ttyd / Homarr / Dockge / Cockpit / Tor Browser.
- **Tools** — the whole `catalog.json`, grouped by category (`web`, `net`,
  `ad`, `exploit`, `osint`, `cloud`, `blue`, `wordlists`, `wireless`).
  Shows installed state + version and streams installs live as jobs.
- **Tool Runner** — clicking a tool opens a runner instead of dumping the bare
  binary into a terminal. Each tool ships **recipes**: pick one, fill the
  fields (target, wordlist, domain…), see the exact command it will run, then
  **Run here** to stream output as a background job or **Terminal** to open it
  interactively. Recipes are tagged `passive` / `active` / `intrusive`, and
  interactive tools (msfconsole, evil-winrm, bettercap) are flagged so you know
  to use a terminal.
- **Library** — an in-depth guide for each tool: what it is actually for, when
  to reach for it, the flags that matter, and example commands. Tools without a
  curated entry still get a generated guide, so nothing in the catalog is a
  dead end.
- **Terminals** — real PTY sessions in `kali-lab`: `shell` (zsh),
  `root`, `tui` (kali-tui), `msf`, or any ad-hoc command. Scrollback is
  ring-buffered server-side, so switching tabs/tabs on mobile reattaches
  and replays instead of losing output.
- **Docker** — containers (start/stop/restart/pause/kill/remove), images,
  and Compose stacks (`up`/`down`/`pull` via Dockge-managed projects),
  with live log streaming.
- **Runbooks** — curated multi-step playbooks that open preloaded
  terminals / run commands.
- **Privacy** — Tor SOCKS status (start/stop), a global "route tool runs
  through Tor" toggle (wraps commands in `proxychains4`), public-IP checks
  for both direct and Tor egress, **WireGuard** tunnel status + up/down,
  and ProtonVPN CLI connect (fastest / country / random / tor /
  secure-core) and disconnect.

All long-running work (installs, compose, log follows, ad-hoc runs) happens
as a **job** with a WebSocket stream, so you can navigate away and come
back to the same output.

---

## Performance

The first paint is deliberately small and the transport is compressed:

- **Code-split routes.** Pages are `React.lazy`; xterm (the biggest
  dependency) only downloads when you open Terminals/Docker/a job log. Initial
  JS went from ~646 KB to ~247 KB raw.
- **gzip on the wire.** `express.static` does not compress, so the backend
  gzips text assets itself (cached per build). The initial bundle drops to
  ~76 KB over the wire - about 8.5x smaller than the original
  uncompressed 646 KB.
- **Warm tool cache.** The tool-status probe runs once at boot and is cached,
  so `/api/tools` answers in ~30 ms instead of waiting on a container exec.
- **Pause-when-hidden polling.** Nothing polls while the tab is in the
  background.

If the UI still feels slow, it is almost always the container exec behind a
first-time tool-status probe - hit refresh on the Tools page and it is instant.

## Mobile behaviour

- Responsive layout: desktop sidebar → phone bottom nav + "More" sheet.
- `viewport-fit=cover` + `env(safe-area-inset-*)` for notches and home bars.
- PWA install (standalone display, dark theme colour).
- Job/terminal WebSockets auto-reconnect; the tab list survives navigation.
- Polling pauses when the tab is hidden to save battery.

---

## Security model

- Everything under `/api` requires a session cookie; state-changing calls
  are additionally same-origin checked.
- The cookie is `HttpOnly; SameSite=Strict`; sessions are in-memory only
  (restart = re-login).
- No `--privileged` on `kali-lab`; only `NET_ADMIN`, `NET_RAW`,
  `SYS_PTRACE`.
- The backend binds loopback by default. Publish it via Tailscale, not by
  binding `0.0.0.0`.
- This is an **authorized-use** lab console. Keep the password strong and
  the tailnet ACLs tight.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `UI not built yet` | `cd kali-deck && npm run build` |
| Blank page after deploy | check `journalctl -u kali-deck -n 50`; confirm `dist/` exists |
| `docker api timeout` / 500s | is the docker socket readable? user must be in the `docker` group |
| Terminal opens then instantly exits | container down: `docker start kali-lab` |
| Marketplace installs hang | the job needs egress from `kali-lab`; check VPN/Tor routing |
| VPN button says "sudo needs a password" | run `sudo kali-deck/setup-sudo.sh` |
| No tailnet URL printed | run `sudo tailscale up` first, then re-run `deploy.sh` |
| WireGuard toggle says sudo needs a password | run `sudo kali-deck/setup-sudo.sh` |
| WireGuard card is empty | no `wg-*` interface exists; start your VPN client first |
| Service stops when you log out | `sudo loginctl enable-linger $USER` (deploy-user.sh path) |
| Mobile keyboard hides the terminal | the terminal auto-fits; rotate or tap the terminal first |

---

## Layout

```
kali-deck/
├── server/            # Express API, WS terminals/jobs, docker, privacy, system
│   ├── index.js       # routes + websocket upgrade
│   ├── auth.js        # session cookie + login throttling
│   ├── docker.js      # Docker Engine API over the unix socket
│   ├── terminals.js   # PTY sessions, ring buffers, orphan reaping
│   ├── jobs.js        # streaming background jobs
│   ├── tools.js       # catalog + installed/version probing
│   ├── privacy.js     # Tor/VPN/public-IP
│   └── system.js      # /proc metrics + service health probes
├── web/               # React SPA (Vite root)
│   ├── src/pages/     # Dashboard, Tools, Terminals, Docker, Runbooks, Privacy
│   ├── src/components/# Layout, TerminalView, LogConsole, UI kit, icons
│   └── public/        # PWA manifest + icon
├── systemd/           # system + user service unit templates
├── deploy.sh          # sudo: build + system service + Tailscale serve
├── deploy-user.sh     # no sudo: build + user service
└── setup-sudo.sh      # protonvpn + wg-quick sudoers rules
```
