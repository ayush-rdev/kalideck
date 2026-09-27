// Terminal sessions: PTYs inside kali-lab attached over WebSocket.
// Sessions survive brief disconnects (mobile tab switches): output is
// ring-buffered and replayed on reattach, orphans are reaped.
import crypto from 'node:crypto'
import { ptyOpen, ptyResize } from './docker.js'
import { config } from './config.js'

const RING_LIMIT = 256 * 1024 // replay buffer per session
const ORPHAN_MS = 5 * 60 * 1000 // keep an unattended session 5 minutes
const EXIT_MS = 90 * 1000 // keep scrollback after exit

const terminals = new Map()

const PRESETS = {
  shell: { cmd: ['/bin/zsh', '-l'], user: 'hacker', workdir: '/work' },
  root: { cmd: ['/bin/zsh', '-l'], user: 'root', workdir: '/root' },
  tui: { cmd: ['bash', '-lc', 'kali-tui'], user: 'hacker', workdir: '/work' },
  msf: { cmd: ['bash', '-lc', 'msfconsole -q'], user: 'hacker', workdir: '/work' },
}

const MAX_CMD = 4096

export function buildTermSpec(params) {
  const preset = params.preset || 'shell'
  if (preset === 'cmd') {
    const cmd = String(params.cmd || '').slice(0, MAX_CMD)
    if (!cmd.trim()) throw new Error('empty command')
    return { ...PRESETS.shell, cmd: ['bash', '-lc', cmd], label: cmd.slice(0, 80) }
  }
  const p = PRESETS[preset]
  if (!p) throw new Error(`unknown preset: ${preset}`)
  return { ...p, label: preset }
}

function ringPush(term, chunk) {
  term.ring.push(chunk)
  term.ringSize += chunk.length
  while (term.ringSize > RING_LIMIT && term.ring.length > 1) {
    term.ringSize -= term.ring.shift().length
  }
}

function send(ws, data, binary = false) {
  if (ws.readyState !== 1) return
  try {
    ws.send(data, { binary })
  } catch {}
}

export async function openTerminal(params) {
  const spec = buildTermSpec(params)
  const cols = Math.min(400, Math.max(20, Number(params.cols) || 100))
  const rows = Math.min(200, Math.max(5, Number(params.rows) || 30))
  const { execId, sock } = await ptyOpen({
    cmd: spec.cmd,
    user: spec.user,
    workdir: spec.workdir,
    cols,
    rows,
  })

  const term = {
    id: crypto.randomBytes(6).toString('hex'),
    execId,
    sock,
    ring: [],
    ringSize: 0,
    clients: new Set(),
    cols,
    rows,
    label: spec.label,
    createdAt: Date.now(),
    lastActive: Date.now(),
    orphanSince: null,
    exited: false,
    exitTimer: null,
  }
  terminals.set(term.id, term)

  sock.on('data', (d) => {
    ringPush(term, d)
    for (const ws of term.clients) send(ws, d, true)
  })
  const onEnd = () => {
    term.exited = true
    for (const ws of term.clients)
      send(ws, JSON.stringify({ t: 'exit' }), false)
    term.clients.clear()
    term.orphanSince = Date.now()
    term.exitTimer = setTimeout(() => terminals.delete(term.id), EXIT_MS)
  }
  sock.on('close', onEnd)
  sock.on('error', onEnd)

  return term
}

export function attachTerminal(termId, ws) {
  const term = terminals.get(termId)
  if (!term) return null
  if (term.exited) return null
  if (term.exitTimer) {
    clearTimeout(term.exitTimer)
    term.exitTimer = null
  }
  term.orphanSince = null
  term.lastActive = Date.now()
  term.clients.add(ws)

  send(ws, JSON.stringify({ t: 'ready', term: term.id, label: term.label }), false)
  // replay scrollback so a reconnect resumes mid-output
  if (term.ring.length) send(ws, Buffer.concat(term.ring), true)

  ws.on('message', (data, isBinary) => {
    term.lastActive = Date.now()
    if (isBinary) {
      // binary frames are terminal input (utf8)
      term.sock.write(Buffer.from(data))
      return
    }
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (msg.t === 'resize') {
      const cols = Math.min(400, Math.max(20, Number(msg.cols) || 0))
      const rows = Math.min(200, Math.max(5, Number(msg.rows) || 0))
      if (cols && rows) {
        term.cols = cols
        term.rows = rows
        ptyResize(term.execId, cols, rows).catch(() => {})
      }
    } else if (msg.t === 'in' && typeof msg.d === 'string') {
      term.sock.write(msg.d)
    }
  })

  const detach = () => {
    term.clients.delete(ws)
    if (term.clients.size === 0 && !term.exited) term.orphanSince = Date.now()
    term.lastActive = Date.now()
  }
  ws.on('close', detach)
  ws.on('error', detach)
  return term
}

// Reap orphaned terminals periodically.
setInterval(() => {
  const now = Date.now()
  for (const [id, t] of terminals) {
    if (t.clients.size === 0 && t.orphanSince && now - t.orphanSince > ORPHAN_MS) {
      try {
        t.sock.destroy()
      } catch {}
      terminals.delete(id)
    }
  }
}, 30_000).unref?.()

export const listTerminals = () =>
  [...terminals.values()].map((t) => ({
    id: t.id,
    label: t.label,
    cols: t.cols,
    rows: t.rows,
    clients: t.clients.size,
    exited: t.exited,
    createdAt: t.createdAt,
  }))
