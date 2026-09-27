# Requirements & Setup Guide

Everything needed to run **Kali Deck** (web console) + **Kali Lab** (Kali
toolbox container) on a fresh machine. `setup.sh` at the repo root automates
all of this — this file documents *what* it installs and *why*, plus the
manual equivalent of every step.

---

## 1. Host requirements

| Requirement | Minimum | Why | Auto-installed by `setup.sh` |
|---|---|---|---|
| OS | Linux (Debian/Ubuntu/Kali tested) | systemd units, bash scripts, apt automation | — |
| **Docker Engine** | 20.10+ with **compose** plugin | runs `kali-lab` + `kali-ttyd`; deck talks to the Docker API | ✅ (Docker Engine + compose plugin from docker.com repo) |
| **Node.js** | **≥ 20** (server runs on v22) | Express backend, Vite build for the React UI | ✅ (Node 20 LTS from nodesource) |
| npm | ships with Node | installs `kali-deck` JS dependencies | ✅ |
| **Python 3** | ≥ 3.11 | `kalitools.py` installer + `kali-tui` run *inside* the container (Kali base ships it) | via container base image |
| curl / git / gnupg | any recent | fetched during setup; used by container builds | ✅ |
| Docker group access | — | the deck needs the Docker **unix socket** | ✅ (`usermod -aG docker`) |
| Tailscale *(optional)* | any | publishes the deck over HTTPS on your tailnet | ❌ manual: `sudo tailscale up` |
| ProtonVPN CLI *(optional)* | community `protonvpn-cli` via pipx | Privacy page connect/disconnect | ❌ optional feature |
| WireGuard tools *(optional)* | `wg-quick` | Privacy page tunnel up/down | ❌ optional feature |

> The deck itself has **no database** — state is `.env` + `.deck-state.json`.

### Node dependencies (`kali-deck/package.json`)

Installed automatically by `npm install` (setup + deploy scripts do this):

- runtime: `express` 5, `ws` 8, `react` 19, `react-dom` 19, `@xterm/xterm` + addons
- build: `vite` 8, `@vitejs/plugin-react`, `tailwindcss` 4 (`@tailwindcss/vite`)
- dev utility: `playwright` (UI smoke tests; optional, browsers not required)

### Python dependencies (inside the container only)

`kalitools.py` and `kali-tui` are stdlib-only — no `pip install` needed. Tool
installs inside the container use apt / pipx / go / pip / gem / cargo / git,
all driven by `catalog.json`.

### Disk, RAM, network

- **Disk:** ~5 GB for a slim build (`kalilinux/kali-rolling` base) or
  **15–20 GB** if you have a pre-baked `kali-saved` image with the full
  toolset. Named volumes (`kali-home`, `kali-root`, `kali-work`) grow with use.
- **RAM:** 2 GB host minimum; the deck itself is a lightweight Node process.
- **Network:** outbound internet for image build + tool installs; tool runs
  can be routed through Tor or VPN from the Privacy page.

---

## 2. What `setup.sh` does (the automated path)

| Step | Action | Idempotent? |
|---|---|---|
| 1 | Installs Docker Engine + compose plugin (docker.com apt repo) if missing | ✅ skips if present |
| 2 | Adds your user to the `docker` group so the deck can reach the socket | ✅ skips if usable |
| 3 | Installs Node.js 20 if `node` is missing or < 20 (nodesource) | ✅ skips if present |
| 4 | Builds `kali-toolbox:latest` from `kali-lab/Dockerfile` — auto-picks `kali-saved` as base when it exists locally, else `kalilinux/kali-rolling` | ✅ Docker layer cache |
| 5 | `docker compose up -d` for `kali-lab` + `kali-ttyd` | ✅ reuses running containers |
| 6 | `npm install` + `npm run build` in `kali-deck/` (production UI → `dist/`) | ✅ npm is incremental |
| 7 | Installs and starts the systemd **user** service (`deploy-user.sh`), or the **system** service + Tailscale Serve with `sudo bash setup.sh --system` | ✅ re-runnable |

Skips/flags:

```bash
bash setup.sh --deck-only   # steps 1-3 only if missing, then 6-7 (no image build)
sudo bash setup.sh --system # full setup + system service + tailscale serve
bash setup.sh --help
```

---

## 3. Manual setup (equivalent, step by step)

### 3.1 Docker + lab stack

```bash
# docker engine + compose (Debian/Ubuntu/Kali) - or your distro's equivalent
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker

# build the toolbox image
cd kali-lab
docker build -t kali-toolbox:latest .          # add --build-arg KALI_BASE=kalilinux/kali-rolling on a fresh box

# start the lab
docker compose up -d
docker exec -it -u hacker kali-lab /bin/zsh    # smoke test, then try: kali-tui
```

`docker-compose.yml` needs a `kali-lab/.env` with `TTYD_USER` / `TTYD_PASSWORD`
(its default is `changeme` — set real values before exposing :7681 anywhere).

### 3.2 The deck

```bash
cd kali-deck
npm install
npm run build                    # emits dist/, served by the backend
npm start                        # http://127.0.0.1:8080
```

Or run it as a service:

```bash
kali-deck/deploy-user.sh         # systemd user service, no sudo
# or, with sudo + tailscale:
sudo kali-deck/deploy.sh         # also publishes https://<machine>.<tailnet>.ts.net/
```

### 3.3 Optional: VPN controls from the UI

```bash
sudo kali-deck/setup-sudo.sh     # narrow sudoers rules: protonvpn + wg-quick wrapper
# revoke any time:
sudo rm /etc/sudoers.d/kali-deck /usr/local/sbin/kali-deck-wg
```

### 3.4 Optional: LAN exposure (think first)

The default binds `127.0.0.1` only. LAN exposure puts a login page on your
Wi-Fi — prefer Tailscale or an SSH tunnel. If you still want it:

```bash
sudo DECK_HOST=0.0.0.0 kali-deck/deploy.sh
# and ideally fence it off:
sudo ufw allow from 192.168.0.0/16 to any port 8080 proto tcp
sudo ufw enable
```

---

## 4. Configuration reference

All configuration is environment-driven (`.env` next to each component or
process env); there is nothing else to edit.

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `DECK_PASSWORD` | `kali-deck/.env` | generated on first run | login password for the deck |
| `DECK_PORT` | `kali-deck/.env` | `8080` | backend listen port |
| `DECK_HOST` | `kali-deck/.env` | `127.0.0.1` | bind address; `0.0.0.0` = LAN |
| `KALI_CONTAINER` | `kali-deck/.env` | `kali-lab` | container the deck drives |
| `KALI_BASE` | docker build arg | `kali-saved` → falls back to `kalilinux/kali-rolling` | base image for the toolbox |
| `TTYD_USER` / `TTYD_PASSWORD` | `kali-lab/.env` | `server` / `changeme` | ttyd web-terminal credentials |

Deck state file: `kali-deck/.deck-state.json` (currently just the
Tor-routing toggle). Sessions live in memory — a service restart means
logging in again.

---

## 5. Verify the installation

```bash
# 1. lab container is up and tools are catalogued
docker exec -it -u hacker kali-lab kali-tui --help   # or zsh, then kali-tui

# 2. deck backend answers
curl -s http://127.0.0.1:8080/api/health              # {"ok":true,...}

# 3. service state (user or system path)
systemctl --user status kali-deck                     # or: systemctl status kali-deck

# 4. log in with the generated password
grep DECK_PASSWORD kali-deck/.env                     # then open http://127.0.0.1:8080/
```

If the UI reports "UI not built yet", run `cd kali-deck && npm run build`.
