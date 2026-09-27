// Privacy panel: Tor daemon inside kali-lab, ProtonVPN on the host, DNS,
// public IP checks and the global "route tool runs through Tor" toggle.
import net from 'node:net'
import fs from 'node:fs'
import { execRun, hostRun } from './docker.js'
import { loadState, saveState } from './config.js'
import { toolStatus } from './tools.js'

const SOCKS_PORT = 9050

function probePort(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    const done = (up) => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(up)
    }
    sock.setTimeout(timeout, () => done(false))
    sock.on('connect', () => done(true))
    sock.on('error', () => done(false))
  })
}

const SYS_NET = '/sys/class/net'

// WireGuard interfaces. Both the official ProtonVPN Linux app and wg-quick
// name their tunnels `wg-<cc>-<tier>-<n>`. Interface names and up-state are
// readable without root (sysfs); the keys and peer list are not, and we
// never need them.
export function wireguardState() {
  let names = []
  try {
    names = fs.readdirSync(SYS_NET).filter((n) => n.startsWith('wg-'))
  } catch {
    return { interfaces: [], active: false, available: false }
  }
  const interfaces = names.map((name) => {
    let up = false
    try {
      const flags = parseInt(
        fs.readFileSync(`${SYS_NET}/${name}/flags`, 'utf8').trim(),
        16
      )
      up = (flags & 0x1) !== 0 // IFF_UP
    } catch {
      /* interface vanished mid-read */
    }
    return { name, up }
  })
  return {
    interfaces,
    active: interfaces.some((i) => i.up),
    available: true,
  }
}

function parseJsonFromOutput(output) {
  const s = output.indexOf('{')
  const e = output.lastIndexOf('}')
  if (s === -1 || e <= s) return null
  try {
    return JSON.parse(output.slice(s, e + 1))
  } catch {
    return null
  }
}

// Public IP via the container (host network, so direct == server's egress IP).
// Several endpoints are tried in order: geo services rate-limit shared Tor
// exit nodes, so the Tor path uses check.torproject.org first.
async function fetchIp({ tor = false } = {}) {
  const socks = `--socks5-hostname 127.0.0.1:${SOCKS_PORT}`
  const attempts = tor
    ? [
        `curl -4 -m 45 -sS ${socks} https://check.torproject.org/api/ip`,
        `curl -4 -m 30 -sS ${socks} https://ifconfig.me/ip`,
      ]
    : [
        'curl -4 -m 12 -sS https://ipwho.is/',
        'curl -4 -m 10 -sS https://check.torproject.org/api/ip',
        'curl -4 -m 10 -sS https://ifconfig.me/ip',
      ]

  for (const cmd of attempts) {
    const { exitCode, output } = await execRun({
      cmd: ['bash', '-lc', cmd],
      tty: false,
      timeoutMs: tor ? 55000 : 15000,
    })
    if (exitCode !== 0) continue

    const parsed = parseJsonFromOutput(output)
    let ip = ''
    const extra = {}
    if (parsed) {
      ip = parsed.IP || parsed.ip || ''
      if (parsed.IsTor !== undefined) extra.isTor = !!parsed.IsTor
      if (parsed.success && parsed.ip) {
        extra.city = parsed.city || ''
        extra.region = parsed.region || ''
        extra.country = parsed.country || ''
        extra.org = parsed.connection?.org || parsed.connection?.isp || ''
      } else if (parsed.city || parsed.org || parsed.country_name) {
        extra.city = parsed.city || ''
        extra.region = parsed.region || ''
        extra.country = parsed.country_name || parsed.country || ''
        extra.org = parsed.org || ''
      }
    }
    if (!ip) ip = (output.trim().split('\n').pop() || '').trim()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return { ip, ...extra, via: tor ? 'tor' : 'direct', ts: Date.now() }
    }
  }
  throw new Error('network check failed')
}

export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

// ProtonVPN CLI state (runs on the HOST, as the deck user).
async function vpnStatus() {
  const which = await hostRun(['sh', '-c', 'command -v protonvpn || true'], {
    timeoutMs: 5000,
  })
  if (!which.output.trim()) return { available: false, initialized: false, connected: false, lines: [] }
  const { exitCode, output } = await hostRun(['protonvpn', 'status'], {
    timeoutMs: 10000,
  })
  const lines = output
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim())
    .filter((l) => l && !l.startsWith('ProtonVPN now offers') && !l.startsWith('Visit https'))
  const text = lines.join('\n')
  const initialized = !/no profile initialized/i.test(output)
  const connected = /\bStatus:\s*Connected\b/i.test(text) || /\bConnected to\b/i.test(text)
  const server = text.match(/Server:\s*(.+)/i)?.[1]?.trim() || ''
  const ip = text.match(/(?:Exit|Your) IP:\s*(\S+)/i)?.[1] || ''
  const protocol = text.match(/Protocol:\s*(\S+)/i)?.[1] || ''
  return {
    available: true,
    initialized,
    connected,
    server,
    ip,
    protocol,
    lines: initialized ? lines : [],
    raw: output.trim(),
    exitCode,
  }
}

let ipCache = { direct: null, tor: null }

export async function privacyState({ refreshIp = false, refreshTorIp = false } = {}) {
  const state = loadState()
  const [socksUp, statusMap, vpn, dns] = await Promise.all([
    probePort(SOCKS_PORT),
    toolStatus().catch(() => ({})),
    vpnStatus(),
    Promise.resolve(
      (fs.readFileSync('/etc/resolv.conf', 'utf8').match(/^nameserver\s+(\S+)/gm) || [])
        .map((l) => l.split(/\s+/)[1])
    ),
  ])

  if (refreshIp || !ipCache.direct) {
    try {
      ipCache.direct = await fetchIp({ tor: false })
    } catch (e) {
      ipCache.direct = { error: String(e.message || e), ts: Date.now() }
    }
  }
  if (socksUp && (refreshTorIp || !ipCache.tor)) {
    try {
      ipCache.tor = await fetchIp({ tor: true })
    } catch (e) {
      ipCache.tor = { error: String(e.message || e), ts: Date.now() }
    }
  }

  return {
    torRoute: !!state.torRoute,
    tor: {
      socksUp,
      socksPort: SOCKS_PORT,
      dataDir: '/tmp/tor-deck',
      running: socksUp,
    },
    tools: {
      tor: !!statusMap.tor,
      proxychains: !!statusMap.proxychains4,
      torsocks: !!statusMap.torsocks,
    },
    vpn,
    wireguard: wireguardState(),
    ip: { direct: ipCache.direct, tor: socksUp ? ipCache.tor : null },
    dns,
    ts: Date.now(),
  }
}

// ------------------------------------------------------------------ actions --
export async function privacyAction(action, params = {}) {
  switch (action) {
    case 'route_on':
      saveState({ torRoute: true })
      return { ok: true, torRoute: true }
    case 'route_off':
      saveState({ torRoute: false })
      return { ok: true, torRoute: false }

    case 'tor_start': {
      const r = await execRun({
        cmd: [
          'bash',
          '-lc',
          `mkdir -p /tmp/tor-deck && tor --SocksPort ${SOCKS_PORT} --DataDirectory /tmp/tor-deck --RunAsDaemon 1`,
        ],
        tty: false,
        timeoutMs: 20000,
      })
      // give it a moment to open the socket
      await new Promise((res) => setTimeout(res, 1500))
      const up = await probePort(SOCKS_PORT)
      return {
        ok: up,
        running: up,
        output: r.output.slice(-3000),
        error: up ? null : `tor did not open port ${SOCKS_PORT}: ${r.output.trim().split('\n').slice(-3).join(' | ')}`,
      }
    }
    case 'tor_stop': {
      const r = await execRun({
        cmd: ['bash', '-lc', 'pkill -x tor || true'],
        tty: false,
        timeoutMs: 10000,
      })
      await new Promise((res) => setTimeout(res, 800))
      const up = await probePort(SOCKS_PORT)
      return { ok: !up, running: up, output: r.output }
    }

    case 'ip_check': {
      try {
        return { ok: true, ip: await fetchIp({ tor: false }) }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    }
    case 'tor_ip_check': {
      if (!(await probePort(SOCKS_PORT)))
        return { ok: false, error: 'tor socks port is not listening' }
      try {
        return { ok: true, ip: await fetchIp({ tor: true }) }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    }

    case 'vpn_connect': {
      const mode = params.mode || 'fastest'
      const flags =
        mode === 'country' && params.cc
          ? ['--cc', String(params.cc).toUpperCase().slice(0, 2)]
          : mode === 'random'
            ? ['-r']
            : mode === 'tor'
              ? ['--tor']
              : mode === 'securecore'
                ? ['--sc']
                : ['-f']
      const r = await hostRun(['sudo', '-n', 'protonvpn', 'connect', ...flags], {
        timeoutMs: 45000,
      })
      if (r.exitCode !== 0) {
        const needsSudo = /password|sudo/i.test(r.output)
        return {
          ok: false,
          output: r.output.slice(-3000),
          error: needsSudo
            ? 'sudo needs a password - run kali-deck/setup-sudo.sh once, or use "Open in terminal"'
            : 'connect failed',
        }
      }
      return { ok: true, output: r.output.slice(-3000), status: await vpnStatus() }
    }
    case 'vpn_disconnect': {
      let r = await hostRun(['sudo', '-n', 'protonvpn', 'disconnect'], {
        timeoutMs: 30000,
      })
      if (r.exitCode !== 0) {
        // some builds can disconnect without root
        r = await hostRun(['protonvpn', 'disconnect'], { timeoutMs: 30000 })
      }
      return {
        ok: r.exitCode === 0,
        output: r.output.slice(-2000),
        status: await vpnStatus(),
        error: r.exitCode === 0 ? null : r.output.trim().split('\n').slice(-2).join(' | '),
      }
    }
    case 'vpn_status':
      return { ok: true, status: await vpnStatus() }

    // Bring a WireGuard tunnel up/down. Needs the wg-quick sudoers rule
    // (setup-sudo.sh), limited to `wg-*` interfaces - and /etc/wireguard is
    // root-owned, so this cannot be turned into arbitrary code execution.
    case 'wg_up':
    case 'wg_down': {
      const wg = wireguardState()
      const name = String(params.name || wg.interfaces[0]?.name || '')
      if (!/^wg-[A-Za-z0-9._-]+$/.test(name))
        return { ok: false, error: 'no WireGuard interface found' }
      const verb = action === 'wg_up' ? 'up' : 'down'
      // The interface-name check lives in this root-owned wrapper, because
      // sudoers forbids wildcards in command arguments.
      const r = await hostRun(
        ['sudo', '-n', '/usr/local/sbin/kali-deck-wg', verb, name],
        { timeoutMs: 45000 }
      )
      return {
        ok: r.exitCode === 0,
        wireguard: wireguardState(),
        output: r.output.slice(-2000),
        error:
          r.exitCode === 0
            ? null
            : /password|sudo/i.test(r.output)
              ? 'sudo needs a password - run kali-deck/setup-sudo.sh'
              : `wg-quick ${verb} failed`,
      }
    }

    default:
      return { ok: false, error: `unknown action: ${action}` }
  }
}
