// kali-deck backend: REST API + WebSocket terminals/jobs + static SPA.
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { WebSocketServer } from 'ws'
import { config, DIST, loadState } from './config.js'
import {
  verifyPassword,
  createSession,
  destroySession,
  getSession,
  sessionToken,
  sessionCookie,
  CLEAR_COOKIE,
  registerAttempt,
  lockedOut,
  sameOrigin,
} from './auth.js'
import {
  containers,
  containerInfo,
  containerAction,
  containerRemove,
  images,
  stacks,
  composeRun,
  execRun,
  logsFollow,
} from './docker.js'
import { createJob, getJob, abortJob, attachJob } from './jobs.js'
import { catalogWithStatus, toolVersion, loadCatalog, toolStatus } from './tools.js'
import { systemSnapshot, serviceHealth } from './system.js'
import { privacyState, privacyAction, shellQuote } from './privacy.js'
import { openTerminal, attachTerminal } from './terminals.js'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .toString()
    .replace(/^::ffff:/, '')

// ------------------------------------------------------------------- auth ---
app.post('/api/login', (req, res) => {
  const ip = clientIp(req)
  if (lockedOut(ip))
    return res.status(429).json({ error: 'too many attempts - wait a bit' })
  if (!sameOrigin(req)) return res.status(403).json({ error: 'bad origin' })
  const ok = verifyPassword(req.body?.password ?? '')
  registerAttempt(ip, ok)
  if (!ok) return res.status(401).json({ error: 'wrong password' })
  const { token } = createSession(ip)
  res.setHeader('Set-Cookie', sessionCookie(token))
  res.json({ ok: true })
})

app.post('/api/logout', (req, res) => {
  destroySession(sessionToken(req))
  res.setHeader('Set-Cookie', CLEAR_COOKIE)
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  const s = getSession(sessionToken(req))
  if (!s) return res.status(401).json({ error: 'unauthorized' })
  res.json({ ok: true, since: s.created })
})

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// Everything below requires a session.
app.use('/api', (req, res, next) => {
  if (!getSession(sessionToken(req)))
    return res.status(401).json({ error: 'unauthorized' })
  if (req.method !== 'GET' && !sameOrigin(req))
    return res.status(403).json({ error: 'bad origin' })
  next()
})

// ----------------------------------------------------------------- system ---
app.get('/api/system', async (_req, res) => {
  try {
    res.json(await systemSnapshot())
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/services', async (_req, res) => {
  try {
    res.json(await serviceHealth({ refresh: true }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ------------------------------------------------------------------ tools ---
app.get('/api/tools', async (req, res) => {
  try {
    res.json(await catalogWithStatus({ refresh: req.query.refresh === '1' }))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/tools/status', async (req, res) => {
  try {
    const map = await toolStatus({ refresh: req.query.refresh === '1' })
    res.json({ map, ts: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/tools/:id/info', async (req, res) => {
  try {
    const cat = loadCatalog()
    const tool = cat.tools.find((t) => t.id === req.params.id)
    if (!tool) return res.status(404).json({ error: 'unknown tool' })
    const v = await toolVersion(tool.id, { refresh: req.query.refresh === '1' }).catch(
      () => ({ installed: null, version: '' })
    )
    res.json({ tool, ...v })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/tools/install', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 60) : []
  if (!ids.length) return res.status(400).json({ error: 'no ids' })
  const cat = loadCatalog()
  const valid = new Set(cat.tools.map((t) => t.id))
  const clean = ids.filter((i) => valid.has(i))
  if (!clean.length) return res.status(400).json({ error: 'no valid ids' })

  const job = createJob({
    kind: 'install',
    title: `install ${clean.length} tool${clean.length > 1 ? 's' : ''}`,
    run: async (emit) => {
      emit(`[deck] installing: ${clean.join(', ')}\n`)
      const r = await execRun({
        cmd: ['kalitools', 'install', ...clean],
        tty: false,
        timeoutMs: 30 * 60 * 1000,
        onChunk: emit,
      })
      // invalidate status cache so the UI refetches when the job ends
      toolStatus({ refresh: true }).catch(() => {})
      return r.exitCode
    },
  })
  res.json({ jobId: job.id })
})

// -------------------------------------------------------------- quick run ---
app.post('/api/run', (req, res) => {
  let cmd = String(req.body?.cmd || '').trim().slice(0, 8000)
  if (!cmd) return res.status(400).json({ error: 'empty command' })
  // Honour the Privacy page's "route runs through Tor" toggle. Previously the
  // toggle only changed a preview string; runs went out direct.
  const torRoute = !!loadState().torRoute
  if (torRoute && !/^proxychains4\b/.test(cmd)) cmd = `proxychains4 -q ${cmd}`
  const timeoutMs = Math.min(Number(req.body?.timeoutMs) || 10 * 60 * 1000, 30 * 60 * 1000)
  const job = createJob({
    kind: 'run',
    title: cmd.slice(0, 100),
    run: async (emit, aborted) => {
      const r = await execRun({
        cmd: ['bash', '-lc', cmd],
        user: 'hacker',
        workdir: '/work',
        tty: true,
        cols: 180,
        rows: 50,
        timeoutMs,
        onChunk: (c) => {
          if (!aborted()) emit(c)
        },
      })
      return r.exitCode ?? (r.killed ? 124 : 0)
    },
  })
  res.json({ jobId: job.id })
})

// ------------------------------------------------------------------ jobs ----
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'no such job' })
  res.json({
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    exitCode: job.exitCode,
    createdAt: job.createdAt,
    lines: job.lines,
  })
})

app.post('/api/jobs/:id/abort', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'no such job' })
  abortJob(job)
  res.json({ ok: true })
})

// ---------------------------------------------------------------- docker ----
app.get('/api/docker/containers', async (_req, res) => {
  try {
    res.json({ containers: await containers(true) })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/docker/containers/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params
    if (action === 'remove') await containerRemove(id)
    else await containerAction(id, action)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/docker/containers/:id/logs', async (req, res) => {
  try {
    const info = await containerInfo(req.params.id)
    const name = (info.Name || '').replace(/^\//, '')
    const tail = Math.min(Number(req.query.tail) || 200, 5000)
    const follow = req.query.follow !== '0'
    const tty = !!info.Config?.Tty
    let stop = null
    const job = createJob({
      kind: 'logs',
      title: `logs: ${name}`,
      follow,
      run: (_emit, aborted) =>
        new Promise((resolve) => {
          stop = logsFollow(info.Id, { tail, tty, follow }, {
            onChunk: (chunk) => {
              if (!aborted()) _emit(chunk)
            },
            onEnd: (err) => {
              if (err && !aborted()) _emit(`\n[deck] log stream: ${err.message}\n`)
              resolve(0)
            },
          })
        }),
    })
    job.abortFns.push(() => stop?.())
    res.json({ jobId: job.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/docker/images', async (_req, res) => {
  try {
    res.json({ images: await images() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/docker/stacks', async (_req, res) => {
  try {
    res.json({ stacks: await stacks() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/docker/stacks/:project/:action', async (req, res) => {
  try {
    const { project, action } = req.params
    if (!['up', 'down', 'pull'].includes(action))
      return res.status(400).json({ error: 'bad action' })
    const all = await stacks()
    const st = all.find((s) => s.name === project)
    if (!st) return res.status(404).json({ error: 'unknown stack' })
    const job = createJob({
      kind: 'compose',
      title: `compose ${action}: ${project}`,
      run: async (emit) =>
        composeRun(project, action, { workingDir: st.workingDir, files: st.files }, emit),
    })
    res.json({ jobId: job.id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ---------------------------------------------------------------- privacy ---
app.get('/api/privacy', async (req, res) => {
  try {
    res.json(
      await privacyState({
        refreshIp: req.query.refresh === '1',
        refreshTorIp: req.query.refresh === '1' && req.query.tor === '1',
      })
    )
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/privacy/action', async (req, res) => {
  try {
    const { action, ...params } = req.body || {}
    res.json(await privacyAction(action, params))
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// -------------------------------------------------------- static frontend ---
// express.static does NOT compress, so send pre-gzipped text assets. The UI
// bundle drops ~646 KB -> ~177 KB over the wire. Compressed buffers are
// cached per mtime, so this costs one gzip per build.
const MIME = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  webmanifest: 'application/manifest+json; charset=utf-8',
}
const GZ_RE = /\.(js|mjs|css|html|json|svg|webmanifest)$/i
const gzCache = new Map()

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next()
  if (!GZ_RE.test(req.path)) return next()
  const rel = decodeURIComponent(req.path).replace(/^\/+/, '')
  const file = path.join(DIST, rel)
  if (!file.startsWith(DIST)) return next()
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return next()
    const key = `${file}:${st.mtimeMs}`
    const hit = gzCache.get(key)
    const send = (buf) => {
      res.setHeader('Content-Encoding', 'gzip')
      res.setHeader('Vary', 'Accept-Encoding')
      res.setHeader('Content-Type', MIME[path.extname(file).slice(1)] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Content-Length', buf.length)
      if (req.method === 'HEAD') return res.end()
      res.end(buf)
    }
    if (hit) return send(hit)
    fs.readFile(file, (e2, data) => {
      if (e2) return next()
      zlib.gzip(data, { level: 6 }, (e3, out) => {
        if (e3) return next()
        if (gzCache.size > 80) gzCache.clear()
        gzCache.set(key, out)
        send(out)
      })
    })
  })
})

const indexHtml = path.join(DIST, 'index.html')
app.use(express.static(DIST, { index: false, maxAge: '1h' }))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml)
  res
    .status(503)
    .type('text/plain')
    .send('UI not built yet.\n\n  cd kali-deck && npm run build\n\nor run the dev server: npm run dev:web  (vite on :5173)')
})

// ---------------------------------------------------------------- websockets -
const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url, 'http://x')
  } catch {
    return socket.destroy()
  }
  const token = (url.searchParams.get('tk') || '') || (req.headers.cookie || '').match(/(?:^|;\s*)dk=([a-f0-9]+)/)?.[1]
  const session = getSession(token)
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
    return socket.destroy()
  }
  const origin = req.headers.origin
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        return socket.destroy()
      }
    } catch {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      return socket.destroy()
    }
  }

  if (url.pathname === '/ws/term') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleTermWs(ws, url)
    })
  } else if (url.pathname === '/ws/job') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleJobWs(ws, url)
    })
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
  }
})

function handleJobWs(ws, url) {
  const job = getJob(url.searchParams.get('job') || '')
  if (!job) {
    ws.send(JSON.stringify({ t: 'error', error: 'no such job' }))
    return ws.close()
  }
  attachJob(job, ws)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.t === 'abort') abortJob(job)
    } catch {}
  })
}

async function handleTermWs(ws, url) {
  try {
    const existing = url.searchParams.get('term')
    const term = existing
      ? attachTerminal(existing, ws)
      : await openTerminal({
          preset: url.searchParams.get('preset') || 'shell',
          cmd: url.searchParams.get('cmd') || '',
          cols: Number(url.searchParams.get('cols')) || 100,
          rows: Number(url.searchParams.get('rows')) || 30,
        })
    if (!term) {
      ws.send(JSON.stringify({ t: 'exit', error: 'session expired' }))
      return ws.close()
    }
    if (!existing) {
      // first attach for a brand-new session
      attachTerminal(term.id, ws)
    }
  } catch (e) {
    try {
      ws.send(JSON.stringify({ t: 'error', error: e.message }))
    } catch {}
    ws.close()
  }
}

server.listen(config.port, config.host, () => {
  console.log(
    `\n  [kali-deck] http://${config.host === '0.0.0.0' ? '<server-ip>' : config.host}:${config.port}\n`
  )
  // Warm the tool-status probe so the first Tools page load is instant.
  toolStatus({ refresh: true }).catch(() => {})
})
