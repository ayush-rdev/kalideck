#!/usr/bin/env python3
"""kalitools - catalog-driven installer/manager for the kali-lab toolbox.

Single source of truth is catalog.json. Used by:
  * Dockerfile          -> bake everything at build time
  * kalitools CLI       -> non-interactive list/install/verify
  * kali-tui            -> the curses front-end

Install kinds: apt | pipx | go | pip | gem | cargo | git | script
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG = HERE / "catalog.json"

# System-wide install locations so tools are on PATH for every user,
# not just whoever ran the install.
GLOBAL_ENV = {
    "PIPX_HOME": "/opt/pipx",
    "PIPX_BIN_DIR": "/usr/local/bin",
    # pipx otherwise uses the system interpreter, which on kali-rolling is
    # Python 3.14 - too new for several catalogued tools (ropper's filebytes
    # imports ast.Str, removed in 3.12). Pin the newest interpreter that works.
    "PIPX_DEFAULT_PYTHON": "/usr/bin/python3.13",
    "GOBIN": "/usr/local/bin",
    "GOPATH": "/opt/go",
    "GOCACHE": "/opt/go-cache",
    "GOMODCACHE": "/opt/go/pkg/mod",
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "DEBIAN_FRONTEND": "noninteractive",
    "HOMEBREW_NO_AUTO_UPDATE": "1",
}

STATE = Path(os.environ.get("KALITOOLS_STATE", "/opt/kalitools/state.json"))


# --------------------------------------------------------------------------- #
# catalog
# --------------------------------------------------------------------------- #
def load_catalog(path: Path | str = CATALOG) -> dict:
    with open(path) as fh:
        cat = json.load(fh)
    cat["tools"].sort(key=lambda t: (t["cat"], t["name"].lower()))
    return cat


def tools_by_id(cat: dict) -> dict:
    return {t["id"]: t for t in cat["tools"]}


def category_names(cat: dict) -> dict:
    return {c["id"]: c["name"] for c in cat["categories"]}


# --------------------------------------------------------------------------- #
# detection
# --------------------------------------------------------------------------- #
def is_installed(tool: dict) -> bool:
    for p in tool.get("detect_paths", []):
        if Path(p).exists():
            return True
    if tool.get("detect_paths"):
        return False
    binary = tool.get("bin")
    return bool(binary and shutil.which(binary))


def version_of(tool: dict) -> str:
    binary = tool.get("bin")
    if not binary:
        return ""
    exe = shutil.which(binary)
    if not exe:
        return ""
    for flag in ("--version", "-version", "-V"):
        try:
            out = subprocess.run(
                [exe, flag], capture_output=True, text=True, timeout=6
            )
            text = (out.stdout or out.stderr).strip().splitlines()
            if text:
                return text[0][:60]
        except Exception:
            continue
    return ""


# --------------------------------------------------------------------------- #
# install
# --------------------------------------------------------------------------- #
def _root(cmd: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return cmd
    return ["sudo", "-n"] + cmd


def build_command(tool: dict) -> list[str] | None:
    """Return the argv that installs this tool."""
    kind = tool["kind"]
    spec = tool["spec"]

    if kind == "apt":
        return _root(["apt-get", "install", "-y", "--no-install-recommends", spec])
    if kind == "pip":
        return _root(["pip3", "install", "--break-system-packages", spec])
    if kind == "pipx":
        return _root(["pipx", "install", "--force", spec])
    if kind == "go":
        return _root(["go", "install", spec])
    if kind == "gem":
        return _root(["gem", "install", "--no-document", spec])
    if kind == "cargo":
        return _root(["cargo", "install", spec, "--root", "/usr/local"])
    if kind == "git":
        dest = tool["dest"]
        return _root(
            [
                "bash",
                "-c",
                f"mkdir -p {Path(dest).parent} && "
                f"rm -rf {dest} && git clone --depth 1 {spec} {dest}",
            ]
        )
    if kind == "script":
        return _root(["bash", "-lc", spec])
    return None


def run_stream(cmd: list[str], log, env_extra: dict | None = None) -> int:
    env = dict(os.environ)
    env.update(GLOBAL_ENV)
    if env_extra:
        env.update(env_extra)

    log(f"$ {' '.join(cmd)}")
    try:
        proc = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError as exc:
        log(f"!! {exc}")
        return 127

    assert proc.stdout is not None
    tail: list[str] = []
    for line in proc.stdout:
        line = line.rstrip("\n")
        if not line:
            continue
        tail.append(line)
        if len(tail) > 400:
            tail.pop(0)
        log(line)
    proc.wait()

    if proc.returncode != 0:
        for line in tail[-3:]:
            log(f"   (last) {line}")
    return proc.returncode


def run_post(tool: dict, log=print) -> None:
    """Run a tool's optional post-install hook.

    Hooks create symlinks and PATH shims for packages that install outside
    PATH (zeek lands in /opt/zeek/bin, Kali ships testssl as `testssl` rather
    than `testssl.sh`). Best-effort by design: a failing hook must not fail an
    otherwise good install, because is_installed() remains the source of truth.
    """
    post = tool.get("post")
    if not post:
        return
    run_stream(_root(["bash", "-lc", post]), log)


def _chunks(seq: list, size: int):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def batch_apt(todo: list[dict], log=print, update: bool = True) -> None:
    """Install every apt-kind tool in as few transactions as possible.

    A single unknown package name aborts a whole apt transaction, so try the
    batch first and silently fall back to per-tool installs on failure.
    """
    apt_tools = [t for t in todo if t["kind"] == "apt" and not is_installed(t)]
    if not apt_tools:
        return
    if update:
        log("[*] apt-get update")
        run_stream(_root(["apt-get", "update"]), log)

    specs = sorted({t["spec"] for t in apt_tools})
    log(f"[*] batch apt install of {len(specs)} package(s)")
    for chunk in _chunks(specs, 25):
        rc = run_stream(
            _root(["apt-get", "install", "-y", "--no-install-recommends"] + chunk), log
        )
        if rc != 0:
            log("[~] batch transaction failed; retrying those individually")


def install(tool: dict, log=print) -> bool:
    """Install one tool. Returns True on success."""
    if is_installed(tool):
        log(f"[=] {tool['name']} already present, skipping")
        return True

    cmd = build_command(tool)
    if cmd is None:
        log(f"[!] {tool['name']}: unknown install kind {tool['kind']!r}")
        return False

    log(f"[+] installing {tool['name']} ({tool['kind']})")
    rc = run_stream(cmd, log)

    # Optional fallback (e.g. apt package missing -> pipx equivalent)
    alt = tool.get("alt")
    if rc != 0 and alt:
        log(f"[~] primary failed, trying fallback: {alt['kind']} {alt['spec']}")
        tmp = dict(tool, kind=alt["kind"], spec=alt["spec"])
        tmp.pop("alt", None)
        rc = run_stream(build_command(tmp), log)

    # Only once the package is on disk: hooks add the symlinks is_installed()
    # looks for.
    if rc == 0:
        run_post(tool, log)

    if rc == 0 and is_installed(tool):
        log(f"[ok] {tool['name']} installed")
        return True
    if rc == 0:
        log(f"[?] {tool['name']}: installer succeeded but {tool['bin']} not on PATH")
        return False
    log(f"[X] {tool['name']} failed (exit {rc})")
    return False


# --------------------------------------------------------------------------- #
# state cache (so the TUI can show last-result without re-probing everything)
# --------------------------------------------------------------------------- #
def save_state(results: dict) -> None:
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({"ts": time.time(), "results": results}, indent=2))
    except Exception:
        pass


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())["results"]
    except Exception:
        return {}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
GREEN, RED, YEL, DIM, RST = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def _mark(tool: dict) -> str:
    return f"{GREEN}installed{RST}" if is_installed(tool) else f"{RED}missing{RST}"


def cmd_list(args, cat: dict) -> int:
    names = category_names(cat)
    current = None
    rows = 0
    for tool in cat["tools"]:
        if args.cat and tool["cat"] != args.cat:
            continue
        installed = is_installed(tool)
        if args.missing and installed:
            continue
        if args.installed and not installed:
            continue
        if tool["cat"] != current:
            current = tool["cat"]
            print(f"\n{names.get(current, current)}")
        print(f"  {tool['id']:24} {_mark(tool):22} {tool['name']}")
        rows += 1
    print(f"\n{rows} tool(s)")
    return 0


def cmd_status(args, cat: dict) -> int:
    names = category_names(cat)
    total = ok = 0
    print(f"{'category':<32} {'installed':>9} {'total':>6}")
    print("-" * 50)
    for cid, cname in names.items():
        items = [t for t in cat["tools"] if t["cat"] == cid]
        inst = sum(1 for t in items if is_installed(t))
        total += len(items)
        ok += inst
        print(f"{cname:<32} {inst:>9} {len(items):>6}")
    print("-" * 50)
    print(f"{'TOTAL':<32} {ok:>9} {total:>6}")
    return 0


def cmd_verify(args, cat: dict) -> int:
    failed = [t for t in cat["tools"] if not is_installed(t)]
    if not failed:
        print(f"{GREEN}all {len(cat['tools'])} tools installed{RST}")
        return 0
    print(f"{YEL}{len(failed)} missing:{RST}")
    for t in failed:
        print(f"  {t['id']:24} {t['cat']:10} {t['name']}")
    return 1


def cmd_install(args, cat: dict) -> int:
    by_id = tools_by_id(cat)
    todo: list[dict] = []

    if args.all:
        todo = list(cat["tools"])
    elif args.cat:
        todo = [t for t in cat["tools"] if t["cat"] == args.cat]
    elif args.ids:
        for ident in args.ids:
            if ident not in by_id:
                print(f"unknown tool id: {ident}", file=sys.stderr)
                return 2
            todo.append(by_id[ident])
    elif args.missing:
        # `install --missing` with no other selection means "everything that is
        # absent". Without this branch --missing only filters an empty list, so
        # the command parses, does nothing, and reports success.
        todo = list(cat["tools"])
    else:
        print(
            "nothing selected: pass tool ids, or use --cat, --all or --missing",
            file=sys.stderr,
        )
        return 2

    if args.missing:
        todo = [t for t in todo if not is_installed(t)]

    batch_apt(todo, print, update=not args.no_update)

    results: dict[str, bool] = {}
    ok = 0
    for tool in todo:
        try:
            good = install(tool, print)
        except Exception as exc:  # never let one tool kill the bake
            print(f"[X] {tool['name']}: {exc}")
            good = False
        results[tool["id"]] = good
        ok += bool(good)

    save_state(results)
    present = sum(1 for t in todo if is_installed(t))
    print(f"\n{present}/{len(todo)} present after run (loop reported {ok} ok)")
    return 0 if present == len(todo) else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="kalitools", description=__doc__)
    p.add_argument("--catalog", default=str(CATALOG))
    sub = p.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("list", help="list tools")
    q.add_argument("--cat")
    q.add_argument("--missing", action="store_true")
    q.add_argument("--installed", action="store_true")
    q.set_defaults(func=cmd_list)

    q = sub.add_parser("status", help="per-category coverage")
    q.set_defaults(func=cmd_status)

    q = sub.add_parser("verify", help="report missing tools")
    q.set_defaults(func=cmd_verify)

    q = sub.add_parser("install", help="install tools")
    q.add_argument("ids", nargs="*")
    q.add_argument("--all", action="store_true")
    q.add_argument("--cat")
    q.add_argument("--missing", action="store_true", help="only what is absent")
    q.add_argument("--no-update", action="store_true", help="skip apt-get update")
    q.set_defaults(func=cmd_install)

    args = p.parse_args(argv)
    cat = load_catalog(args.catalog)
    return args.func(args, cat)


if __name__ == "__main__":
    sys.exit(main())
