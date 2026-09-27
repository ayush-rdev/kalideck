import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, '..')
export const DIST = path.join(ROOT, 'dist')
// the lab lives one directory up from the deck
export const CATALOG = path.resolve(ROOT, '..', 'kali-lab', 'catalog.json')
export const STATE_FILE = path.join(ROOT, '.deck-state.json')

// Minimal .env loader - no dependency needed for six lines of parsing.
const ENV_FILE = path.join(ROOT, '.env')
function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {}
  const out = {}
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile(), ...process.env }

function ensurePassword() {
  if (env.DECK_PASSWORD) return env.DECK_PASSWORD
  const pw = crypto.randomBytes(9).toString('base64url')
  const note = `# kali-deck generated ${new Date().toISOString()}\nDECK_PASSWORD=${pw}\n`
  try {
    fs.appendFileSync(ENV_FILE, `\n${note}`)
  } catch {
    /* unwritable env - password still valid for this run */
  }
  console.log(
    `\n  [kali-deck] no DECK_PASSWORD set - generated one for you:\n\n      ${pw}\n\n  (saved in kali-deck/.env - change it any time)\n`
  )
  return pw
}

export const config = {
  port: Number(env.DECK_PORT || 8080),
  password: ensurePassword(),
  container: env.KALI_CONTAINER || 'kali-lab',
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  isProd: process.env.NODE_ENV === 'production',
  // bind address: localhost by default; set DECK_HOST=0.0.0.0 to expose
  host: env.DECK_HOST || '127.0.0.1',
}

// Small persistent state (privacy toggles etc). Kept as one JSON file.
let stateCache = null
export function loadState() {
  if (stateCache) return stateCache
  try {
    stateCache = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    stateCache = {}
  }
  return stateCache
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch }
  stateCache = s
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
  } catch {
    /* non-fatal */
  }
  return s
}
