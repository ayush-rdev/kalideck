# kali-lab

The Kali Linux toolbox container that **kali-deck** drives. It can also be
used standalone — the deck is optional.

```bash
cd kali-lab
docker compose up -d
docker exec -it -u hacker kali-lab /bin/zsh   # then run: kali-tui
```

## What's in here

| File | Purpose |
|---|---|
| `Dockerfile` | The toolbox image. Base image is `kali-saved` when it exists locally (a pre-baked image with the full toolset), else `kalilinux/kali-rolling` — override with `--build-arg KALI_BASE=<image>`. Creates the `hacker` user if the base lacks it, installs build toolchains, adds the osquery/Zeek apt repos, and bakes the whole `catalog.json` toolset at build time. |
| `docker-compose.yml` | Two services on host networking: **kali-lab** (the toolbox, `sleep infinity`, NOT privileged — only `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`) and **kali-ttyd** (web terminal for `kali-tui` on :7681). Named volumes `kali-home`, `kali-root`, `kali-work` keep loot/notes across recreations. |
| `catalog.json` | Single source of truth: 60+ tools across 9 categories (`web`, `net`, `ad`, `exploit`, `osint`, `cloud`, `blue`, `wordlists`, `wireless`) with install kind, version probe, and runner recipes. The deck's Tools/Library/Runner pages render this. |
| `kalitools.py` | Catalog-driven installer (`apt | pipx | go | pip | gem | cargo | git | script`). Also a CLI: `kalitools list/install/verify/status`. Stdlib-only Python. |
| `kali-tui` | Curses front-end over `kalitools.py` for browsing and installing tools inside the container. |

## Build options

```bash
# fast: use a local pre-baked image (setup.sh does this automatically when present)
docker build -t kali-toolbox:latest .

# fresh machine: official rolling base; catalog tools install at build time
docker build --build-arg KALI_BASE=kalilinux/kali-rolling -t kali-toolbox:latest .

# base image only, skip the (slow) tool bake
docker build --build-arg KALITOOLS_SKIP_INSTALL=1 -t kali-toolbox:latest .
```

Some upstream packages will inevitably fail on kali-rolling — that is by
design; individual failures don't sink the image. Check coverage inside the
container with `kalitools verify` (also dumped to `/opt/kalitools/MISSING.txt`
at build time) and re-run installs from the TUI.

## ttyd credentials

`kali-ttyd` reads `TTYD_USER` / `TTYD_PASSWORD` from `kali-lab/.env`
(defaults `server` / `changeme`). Set real values before exposing :7681
anywhere, or keep it loopback/tailnet-only.

## Security notes

- The container is deliberately **not** `--privileged`; it gets only the
  capabilities the toolset needs (`NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`).
- Passwordless sudo is granted **inside the container only** (for on-demand
  tool installs). Never mount the host docker socket into it or run it
  privileged, or that containment stops being true.
- Host networking keeps scan results honest (no NAT rewriting of source IPs)
  — scope your testing accordingly.
