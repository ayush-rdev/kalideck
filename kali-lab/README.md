# kali-lab

The Kali Linux toolbox that Kali Deck drives. Usable on its own; the deck
is optional.

```bash
cd kali-lab
docker compose up -d
docker exec -it -u hacker kali-lab /bin/zsh   # then run kali-tui
```

## Files

| | |
|---|---|
| `Dockerfile` | The image. Base is `kali-saved` when present locally, otherwise `kalilinux/kali-rolling`; override with `--build-arg KALI_BASE=<image>`. Creates the `hacker` user if the base lacks it, installs build toolchains, adds the osquery and Zeek repos, and bakes the whole `catalog.json` toolset. |
| `docker-compose.yml` | `kali-lab` (host network, `NET_ADMIN` + `NET_RAW` + `SYS_PTRACE`, no privileged mode) and `kali-ttyd` (web terminal on :7681). Named volumes `kali-home`, `kali-root`, `kali-work` persist loot and notes. |
| `catalog.json` | Single source of truth: ~60 tools in 9 categories with install kind, version probe, and runner recipes. The deck's Tools, Library and Runner pages render it. |
| `kalitools.py` | Catalog-driven installer (`apt`, `pipx`, `go`, `pip`, `gem`, `cargo`, `git`, `script`) and a CLI: `kalitools list/install/verify/status`. Stdlib-only Python. |
| `kali-tui` | Curses front-end over `kalitools.py`. |

## Building

```bash
# fast: local pre-baked base (setup.sh picks this automatically when present)
docker build -t kali-toolbox:latest .

# fresh machine: official rolling base, tools install at build time
docker build --build-arg KALI_BASE=kalilinux/kali-rolling -t kali-toolbox:latest .

# base image only, skip the tool bake
docker build --build-arg KALITOOLS_SKIP_INSTALL=1 -t kali-toolbox:latest .
```

Some upstream packages fail on kali-rolling by design; one bad package does
not sink the image. Check coverage with `kalitools verify` inside the
container — it is also dumped to `/opt/kalitools/MISSING.txt` at build time.

## Security notes

- Host networking keeps scan results honest (no NAT rewriting of source
  IPs). Scope your testing accordingly.
- Passwordless sudo is granted inside the container only, for on-demand tool
  installs. Never run this container privileged or mount the host docker
  socket into it, or that containment stops being true.
- ttyd credentials come from `kali-lab/.env` (`TTYD_USER` /
  `TTYD_PASSWORD`, default `changeme`). Set real values before exposing
  :7681 anywhere.
