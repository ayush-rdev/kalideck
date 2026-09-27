# kali-lab toolbox
#
# Layered on top of the existing kali-saved image so we keep the 15 GB of
# tooling already installed. Everything the catalog describes is baked in at
# build time; the TUI can still install anything new on demand.
#
# Build:  docker build -t kali-toolbox <path-to>/kali-lab
# Run:    docker compose -f <path-to>/kali-lab/docker-compose.yml up -d
# Use:    docker exec -it -u hacker kali-lab /bin/zsh      (your `kali` alias)
#
# Base image selection, most specific first:
#   1. kali-saved   - your own cached image with the full toolset already
#                     baked in (fast, huge). The setup script sets
#                     KALI_BASE=kali-saved when it detects one locally.
#   2. KALI_BASE    - any base you want, e.g. KALI_BASE=kalilinux/kali-rolling
#   3. default      - kalilinux/kali-rolling (official, ~120 MB, tools are
#                     installed at build time from catalog.json)
#
# If the chosen base has no `hacker` user (the official images do not), one
# is created automatically, so the container is identical either way.
ARG KALI_BASE=kali-saved
FROM ${KALI_BASE}

# pipx otherwise picks the system interpreter, which on kali-rolling is Python
# 3.14 - too new for several catalogued tools (ropper's filebytes imports
# ast.Str, removed in 3.12). Keep in sync with GLOBAL_ENV in kalitools.py.
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin \
    PIPX_DEFAULT_PYTHON=/usr/bin/python3.13 \
    GOBIN=/usr/local/bin \
    GOPATH=/opt/go \
    GOCACHE=/opt/go-cache \
    GOMODCACHE=/opt/go/pkg/mod \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# --- 0. ensure the unprivileged user the toolbox expects ------------------- #
# kali-saved already has `hacker`; official Kali images do not. Create it
# only when missing so the same Dockerfile works with either base.
RUN set -eux; \
    if ! id hacker >/dev/null 2>&1; then \
      useradd -m -s /bin/zsh -u 1000 hacker; \
    fi

# --- 1. toolchains that the catalog's install kinds depend on ---------------- #
RUN apt-get update && apt-get install -y --no-install-recommends \
        golang-go \
        jq \
        fzf \
        python3-pip \
        python3-venv \
        python3.13 \
        python3.13-venv \
        pipx \
        gnupg \
        ca-certificates \
        curl \
        wget \
        git \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# --- 2. third-party apt repos for tools Kali does not package ------------- #
# Neither osquery nor Zeek exists in the Kali/Debian archives, so they come
# from their upstream repositories. Both are keyed rather than trusted=yes, so
# a compromise at either origin cannot silently serve us a package.
RUN set -eux; \
    curl -fsSL https://pkg.osquery.io/deb/pubkey.gpg \
        | gpg --dearmor -o /usr/share/keyrings/osquery.gpg; \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/osquery.gpg] https://pkg.osquery.io/deb deb main" \
        > /etc/apt/sources.list.d/osquery.list; \
    curl -fsSL https://download.opensuse.org/repositories/security:/zeek/Debian_13/Release.key \
        | gpg --dearmor -o /etc/apt/trusted.gpg.d/security_zeek.gpg; \
    echo "deb https://download.opensuse.org/repositories/security:/zeek/Debian_13/ " \
        > /etc/apt/sources.list.d/security_zeek.list; \
    apt-get update

# --- 3. shared loot directory ---------------------------------------------- #
# /work is a mounted named volume. Docker re-seeds an *empty* volume from the
# image on every container create, so an empty root-owned /work would silently
# reset to root:root whenever the stack is recreated. Owning it here in the
# image means the volume inherits hacker ownership and stays writable.
RUN mkdir -p /work && chown hacker:hacker /work

# --- 4. lab convenience: passwordless sudo inside THIS container only -------- #
# The TUI installs tools on demand without a password prompt. This grants root
# inside the container, never on the host. Do not run this container with
# --privileged or with the host docker socket mounted, or that sentence stops
# being true.
RUN printf '%s\n' 'hacker ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/99-hacker-lab \
    && chmod 0440 /etc/sudoers.d/99-hacker-lab \
    && visudo -cf /etc/sudoers.d/99-hacker-lab

# --- 5. the manager and its catalog ----------------------------------------- #
WORKDIR /opt/kalitools
COPY catalog.json kalitools.py kali-tui ./
RUN chmod 0755 kali-tui kalitools.py \
    && ln -sf /opt/kalitools/kali-tui /usr/local/bin/kali-tui \
    && ln -sf /opt/kalitools/kalitools.py /usr/local/bin/kalitools \
    && python3 -c "import json; json.load(open('/opt/kalitools/catalog.json'))" \
    && python3 -c "import ast; ast.parse(open('/opt/kalitools/kali-tui').read())"

# --- 6. bake the toolbox ---------------------------------------------------- #
# Individual tools are allowed to fail: a missing upstream package must not
# cost us the whole image. `kalitools verify` reports what did not land and
# the TUI can retry any of it later. KALITOOLS_SKIP_INSTALL=1 skips this for
# a fast base-only image.
RUN python3 /opt/kalitools/kalitools.py install --all || true

# --- 7. record coverage so it is visible on first login --------------------- #
RUN python3 /opt/kalitools/kalitools.py status | tee /opt/kalitools/STATUS.txt; \
    python3 /opt/kalitools/kalitools.py verify > /opt/kalitools/MISSING.txt 2>&1; \
    true

WORKDIR /root
CMD ["/bin/zsh"]
