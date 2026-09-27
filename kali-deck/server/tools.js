// Tool catalog: reads ../kali-lab/catalog.json and computes installed
// status by asking kalitools INSIDE the container (single exec, cached).
import { execRun } from './docker.js'
import { CATALOG } from './config.js'
import fs from 'node:fs'

const STATUS_TTL = 90_000
const VERSION_TTL = 300_000

let statusCache = { ts: 0, map: null, running: null }
const versionCache = new Map() // id -> { ts, version }

export function loadCatalog() {
  const raw = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
  raw.tools.sort((a, b) => a.name.localeCompare(b.name))
  return raw
}

const STATUS_SCRIPT = `
import sys, json
sys.path.insert(0, '/opt/kalitools')
import kalitools
cat = kalitools.load_catalog()
print(json.dumps({t['id']: bool(kalitools.is_installed(t)) for t in cat['tools']}))
`.trim()

// Cached map { toolId: installedBool }. Concurrent callers share one exec.
export function toolStatus({ refresh = false } = {}) {
  if (refresh) statusCache.ts = 0
  const fresh = statusCache.map && Date.now() - statusCache.ts < STATUS_TTL
  if (fresh) return Promise.resolve(statusCache.map)
  if (statusCache.running) return statusCache.running

  statusCache.running = execRun({
    cmd: ['python3', '-c', STATUS_SCRIPT],
    tty: false,
    timeoutMs: 45000,
  })
    .then(({ exitCode, output }) => {
      const line = output
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('{'))
        .pop()
      if (exitCode !== 0 || !line) throw new Error('status probe failed')
      statusCache.map = JSON.parse(line)
      statusCache.ts = Date.now()
      return statusCache.map
    })
    .finally(() => {
      statusCache.running = null
    })
  return statusCache.running
}

const VERSION_SCRIPT = `
import sys, json
sys.path.insert(0, '/opt/kalitools')
import kalitools
cat = kalitools.load_catalog()
by = kalitools.tools_by_id(cat)
t = by[sys.argv[1]]
print(json.dumps({"installed": kalitools.is_installed(t), "version": kalitools.version_of(t) if kalitools.is_installed(t) else ""}))
`.trim()

export async function toolVersion(id, { refresh = false } = {}) {
  const cached = versionCache.get(id)
  if (!refresh && cached && Date.now() - cached.ts < VERSION_TTL) return cached
  const { exitCode, output } = await execRun({
    cmd: ['python3', '-c', VERSION_SCRIPT, id],
    tty: false,
    timeoutMs: 25000,
  })
  const line = output
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('{'))
    .pop()
  if (exitCode !== 0 || !line) throw new Error('version probe failed')
  const val = { ts: Date.now(), ...JSON.parse(line) }
  versionCache.set(id, val)
  return val
}

// Merge catalog + status for the UI.
export async function catalogWithStatus({ refresh = false } = {}) {
  const cat = loadCatalog()
  let map = {}
  let statusError = null
  try {
    map = await toolStatus({ refresh })
  } catch (e) {
    statusError = e.message
  }
  const categories = cat.categories.map((c) => {
    const tools = cat.tools.filter((t) => t.cat === c.id)
    return {
      ...c,
      total: tools.length,
      installed: tools.filter((t) => map[t.id]).length,
    }
  })
  return {
    categories,
    tools: cat.tools.map((t) => ({ ...t, installed: !!map[t.id] })),
    statusAt: statusCache.ts || null,
    statusError,
  }
}
