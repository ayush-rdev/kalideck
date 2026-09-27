// Host system metrics: CPU, memory, disks, network, load + cached service
// health probes. Everything is read from /proc - no external dependencies.
import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import { containers } from './docker.js'

let prevCpu = null // { ts, cores: [{idle,total}], idle, total }
let lastCpuPct = 0
let lastCpuPerCore = []
let prevNet = null
let lastNetRate = { rx: 0, tx: 0 }

// services we surface on the dashboard (lab links + health)
const SERVICES = [
  { id: 'deck', name: 'Kali Deck', port: 8080, url: '/', self: true },
  { id: 'ttyd', name: 'kali-tui (ttyd)', port: 7681, url: '/' },
  { id: 'homarr', name: 'Homarr', port: 7575, url: '/' },
  { id: 'dockge', name: 'Dockge', port: 3001, url: '/' },
  { id: 'cockpit', name: 'Cockpit', port: 9090, url: '/' },
  { id: 'torbrowser', name: 'Tor Browser', port: 5800, url: '/' },
  { id: 'streamlit', name: 'Streamlit app', port: 8501, url: '/' },
]

let svcCache = { ts: 0, map: {} }

function probe(port, timeout = 1500) {
  return new Promise((resolve) => {
    const started = Date.now()
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout },
      (res) => {
        res.resume()
        resolve({ up: true, ms: Date.now() - started, code: res.statusCode })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ up: false })
    })
    req.on('error', () => resolve({ up: false }))
  })
}

export async function serviceHealth({ refresh = false } = {}) {
  if (!refresh && Date.now() - svcCache.ts < 12000) return svcCache.map
  const results = await Promise.all(
    SERVICES.map((s) =>
      probe(s.port).then((r) => [
        s.id,
        { up: r.up, ms: r.ms ?? null, code: r.code ?? null },
      ])
    )
  )
  svcCache = { ts: Date.now(), map: Object.fromEntries(results) }
  return svcCache.map
}

function readProcStat() {
  const raw = fs.readFileSync('/proc/stat', 'utf8')
  const cores = []
  let aggregate = null
  for (const line of raw.split('\n')) {
    const m = line.match(/^cpu(\d*)\s+(.*)$/)
    if (!m) continue
    const nums = m[2].split(/\s+/).map(Number)
    // user nice system idle iowait irq softirq steal ...
    const idle = (nums[3] || 0) + (nums[4] || 0)
    const total = nums.reduce((a, b) => a + b, 0)
    const entry = { idle, total }
    if (m[1] === '') aggregate = entry
    else cores.push(entry)
  }
  return { aggregate, cores }
}

function cpuSnapshot() {
  const now = Date.now()
  const cur = readProcStat()
  if (!prevCpu || now - prevCpu.ts > 400) {
    const dt = cur.aggregate.total - (prevCpu?.aggregate.total ?? 0)
    const di = cur.aggregate.idle - (prevCpu?.aggregate.idle ?? 0)
    if (prevCpu && dt > 0) {
      lastCpuPct = Math.round(100 * (1 - di / dt))
      lastCpuPerCore = cur.cores.map((c, i) => {
        const p = prevCpu.cores[i] || c
        const t = c.total - p.total
        const id = c.idle - p.idle
        return t > 0 ? Math.round(100 * (1 - id / t)) : 0
      })
    }
    prevCpu = { ts: now, ...cur }
  }
  return { pct: lastCpuPct, perCore: lastCpuPerCore }
}

function readMem() {
  const raw = fs.readFileSync('/proc/meminfo', 'utf8')
  const get = (k) => {
    const m = raw.match(new RegExp(`^${k}:\\s+(\\d+)\\s*kB`, 'm'))
    return m ? Number(m[1]) * 1024 : 0
  }
  return {
    total: get('MemTotal'),
    free: get('MemFree'),
    available: get('MemAvailable'),
    buffers: get('Buffers'),
    cached: get('Cached'),
    swapTotal: get('SwapTotal'),
    swapFree: get('SwapFree'),
  }
}

function readDisks() {
  const out = []
  for (const p of ['/', '/home']) {
    try {
      const s = fs.statfsSync(p)
      const total = s.blocks * s.bsize
      const avail = s.bavail * s.bsize
      const free = s.bfree * s.bsize
      const used = total - free
      out.push({
        path: p,
        total,
        used,
        avail,
        pct: total ? Math.round((used / total) * 100) : 0,
      })
    } catch {}
  }
  return out
}

function netSnapshot() {
  const raw = fs.readFileSync('/proc/net/dev', 'utf8')
  let rx = 0
  let tx = 0
  for (const line of raw.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/)
    if (!m) continue
    const iface = m[1].trim()
    if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('br-'))
      continue
    const f = m[2].split(/\s+/).map(Number)
    rx += f[0] || 0
    tx += f[8] || 0
  }
  const now = Date.now()
  if (prevNet && now - prevNet.ts > 800) {
    const dt = (now - prevNet.ts) / 1000
    lastNetRate = {
      rx: Math.max(0, Math.round((rx - prevNet.rx) / dt)),
      tx: Math.max(0, Math.round((tx - prevNet.tx) / dt)),
    }
  }
  prevNet = { ts: now, rx, tx }
  return { rx, tx, rxRate: lastNetRate.rx, txRate: lastNetRate.tx }
}

let dockerCache = { ts: 0, data: null }

async function dockerSummary() {
  if (Date.now() - dockerCache.ts < 5000 && dockerCache.data)
    return dockerCache.data
  try {
    const list = await containers(true)
    const data = {
      total: list.length,
      running: list.filter((c) => c.State === 'running').length,
      stopped: list.filter((c) => c.State !== 'running').length,
      unhealthy: list.filter((c) =>
        (c.Status || '').includes('(unhealthy)')
      ).length,
    }
    dockerCache = { ts: Date.now(), data }
    return data
  } catch (e) {
    return { total: 0, running: 0, stopped: 0, error: e.message }
  }
}

export async function systemSnapshot({ refreshServices = false } = {}) {
  const [services, docker] = await Promise.all([
    serviceHealth({ refresh: refreshServices }),
    dockerSummary(),
  ])
  return {
    ts: Date.now(),
    host: {
      hostname: os.hostname(),
      kernel: os.release(),
      arch: os.arch(),
      uptime: os.uptime(),
      user: process.env.USER || 'server',
    },
    cpu: { ...cpuSnapshot(), cores: os.availableParallelism?.() ?? os.cpus().length, load: os.loadavg() },
    mem: readMem(),
    disks: readDisks(),
    net: netSnapshot(),
    docker,
    services,
    servicesInfo: SERVICES,
  }
}
