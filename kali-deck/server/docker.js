// Docker Engine API client over the unix socket. No npm dependencies:
// plain HTTP for regular calls, hijacked connections for exec/PTY streams.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { config } from './config.js'

const SOCK = '/var/run/docker.sock'

// ---------------------------------------------------------------- HTTP API --
export function api(method, p, body, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined || body === null
        ? null
        : Buffer.from(JSON.stringify(body))
    const req = http.request(
      {
        socketPath: SOCK,
        path: p,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': payload.length,
            }
          : {},
        timeout,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode >= 400) {
            let msg = buf.toString().slice(0, 600)
            try {
              msg = JSON.parse(buf).message || msg
            } catch {}
            return reject(
              new Error(`${method} ${p} -> ${res.statusCode}: ${msg}`)
            )
          }
          if (!buf.length) return resolve(null)
          try {
            resolve(JSON.parse(buf))
          } catch {
            resolve(buf.toString())
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('docker api timeout')))
    req.on('error', reject)
    req.end(payload || undefined)
  })
}

// ---------------------------------------------------------- hijacked stream --
// The /exec/{id}/start endpoint upgrades the connection and then speaks a
// raw byte stream. We hand-roll the request so the parser never gets in
// the way of the PTY bytes.
function hijack(pathName, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(bodyObj)
    const head =
      `POST ${pathName} HTTP/1.1\r\n` +
      `Host: docker\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
      `Connection: upgrade\r\n` +
      `Upgrade: tcp\r\n\r\n`
    const sock = net.connect(SOCK)
    let buf = Buffer.alloc(0)
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        sock.destroy()
        reject(new Error('exec start timeout'))
      }
    }, 20000)
    sock.on('connect', () => {
      sock.write(head)
      sock.write(payload)
    })
    sock.on('data', (d) => {
      if (done) return
      buf = Buffer.concat([buf, d])
      const idx = buf.indexOf('\r\n\r\n')
      if (idx === -1) return
      done = true
      clearTimeout(timer)
      const statusLine = buf.subarray(0, idx).toString().split('\r\n')[0]
      const code = Number(statusLine.split(' ')[1])
      if (code !== 101 && code !== 200) {
        sock.destroy()
        return reject(new Error(`exec start failed: ${statusLine}`))
      }
      resolve(sock)
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      if (!done) reject(e)
    })
    sock.on('close', () => {
      clearTimeout(timer)
      if (!done) reject(new Error('connection closed during exec start'))
    })
  })
}

// Demux a Docker non-TTY stream: 8-byte header [type,0,0,0,len BE] + payload.
function demuxPull(buf) {
  if (buf.length < 8) return null
  const len = buf.readUInt32BE(4)
  if (buf.length < 8 + len) return null
  return { payload: buf.subarray(8, 8 + len), used: 8 + len }
}

// --------------------------------------------------------------------- exec --
export async function execCreate({
  cmd,
  user,
  workdir,
  env = [],
  tty = false,
  stdin = false,
}) {
  return api('POST', `/containers/${config.container}/exec`, {
    AttachStdin: stdin || tty,
    AttachStdout: true,
    AttachStderr: true,
    Tty: tty,
    User: user || undefined,
    WorkingDir: workdir || undefined,
    Env: env.length ? env : undefined,
    Cmd: cmd,
  })
}

async function execExitCode(execId, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const info = await api('GET', `/exec/${execId}/json`, null, {
        timeout: 5000,
      })
      if (!info.Running) return info.ExitCode ?? 0
    } catch {}
    await new Promise((r) => setTimeout(r, 120))
  }
  return null
}

// One-shot command inside the lab container. Streams chunks via onChunk and
// resolves with { exitCode, output, killed }.
export async function execRun({
  cmd,
  user,
  workdir,
  env = [],
  tty = false,
  cols = 160,
  rows = 60,
  timeoutMs = 120000,
  onChunk,
  maxOutput = 600000,
}) {
  const exec = await execCreate({ cmd, user, workdir, env, tty })
  const sock = await hijack(`/exec/${exec.Id}/start`, {
    Detach: false,
    Tty: tty,
  })
  if (tty) {
    api(
      'POST',
      `/exec/${exec.Id}/resize?h=${rows}&w=${cols}`,
      null,
      { timeout: 5000 }
    ).catch(() => {})
  }

  return new Promise((resolve) => {
    let out = ''
    let pending = Buffer.alloc(0)
    let killed = false
    let settled = false

    const timer = setTimeout(() => {
      killed = true
      sock.destroy()
    }, timeoutMs)

    const finish = async (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const exitCode = code ?? (await execExitCode(exec.Id))
      resolve({ exitCode, output: out, killed })
    }

    sock.on('data', (d) => {
      let chunk = d
      if (!tty) {
        pending = Buffer.concat([pending, d])
        const parts = []
        for (;;) {
          const m = demuxPull(pending)
          if (!m) break
          parts.push(m.payload)
          pending = pending.subarray(m.used)
        }
        if (!parts.length) return
        chunk = Buffer.concat(parts)
      }
      const text = chunk.toString('utf8')
      out += text
      if (out.length > maxOutput) out = out.slice(-maxOutput)
      onChunk?.(text)
    })
    sock.on('close', () => finish(null))
    sock.on('error', () => finish(null))
  })
}

// ---------------------------------------------------------------------- PTY --
export async function ptyOpen({
  cmd,
  user,
  workdir,
  env = [],
  cols = 100,
  rows = 30,
}) {
  const exec = await execCreate({
    cmd,
    user,
    workdir,
    env: ['TERM=xterm-256color', 'COLORTERM=truecolor', ...env],
    tty: true,
    stdin: true,
  })
  const sock = await hijack(`/exec/${exec.Id}/start`, {
    Detach: false,
    Tty: true,
  })
  await api('POST', `/exec/${exec.Id}/resize?h=${rows}&w=${cols}`, null, {
    timeout: 5000,
  }).catch(() => {})
  return { execId: exec.Id, sock }
}

export function ptyResize(execId, cols, rows) {
  return api(
    'POST',
    `/exec/${execId}/resize?h=${Math.max(1, rows)}&w=${Math.max(1, cols)}`,
    null,
    { timeout: 5000 }
  )
}

// ------------------------------------------------------------- containers ---
export const containers = (all = true) =>
  api('GET', `/containers/json?all=${all ? 1 : 0}&limit=300`)

export const containerInfo = (id) => api('GET', `/containers/${id}/json`)

export async function containerAction(id, action) {
  const allowed = {
    start: '',
    stop: '?t=8',
    restart: '?t=8',
    pause: '',
    unpause: '',
    kill: '?signal=SIGTERM',
  }
  if (!(action in allowed)) throw new Error(`unsupported action: ${action}`)
  await api('POST', `/containers/${id}/${action}${allowed[action]}`)
  return true
}

export async function containerRemove(id) {
  await api('DELETE', `/containers/${id}?force=1&v=0`)
  return true
}

// Stream container logs (follow). Returns an abort function.
export function logsFollow(id, { tail = 200, tty = false, follow = true, since } = {}, { onChunk, onEnd } = {}) {
  const p =
    `/containers/${id}/logs?follow=${follow ? 1 : 0}&stdout=1&stderr=1&tail=${tail}` +
    (since ? `&since=${since}` : '')
  let req
  let pending = Buffer.alloc(0)
  let ended = false
  const end = (err) => {
    if (ended) return
    ended = true
    onEnd?.(err)
  }
  try {
    req = http.request({ socketPath: SOCK, path: p, method: 'GET' }, (res) => {
      if (res.statusCode >= 400) {
        let msg = `log stream failed (${res.statusCode})`
        res.resume()
        return end(new Error(msg))
      }
      res.on('data', (d) => {
        if (tty) return onChunk?.(d.toString('utf8'))
        pending = Buffer.concat([pending, d])
        for (;;) {
          const m = demuxPull(pending)
          if (!m) break
          onChunk?.(m.payload.toString('utf8'))
          pending = pending.subarray(m.used)
        }
      })
      res.on('end', () => end(null))
      res.on('error', (e) => end(e))
    })
    req.on('error', (e) => end(e))
    req.end()
  } catch (e) {
    end(e)
  }
  return () => {
    try {
      req?.destroy()
    } catch {}
    end(null)
  }
}

// ------------------------------------------------------------------ images ---
export const images = () => api('GET', '/images/json')

// ------------------------------------------------------------------ stacks ---
export async function stacks() {
  const list = (await containers(true)) || []
  const byProject = new Map()
  for (const c of list) {
    const L = c.Labels || {}
    const project = L['com.docker.compose.project']
    if (!project) continue
    if (!byProject.has(project))
      byProject.set(project, {
        name: project,
        workingDir: L['com.docker.compose.project.working_dir'] || '',
        files: L['com.docker.compose.project.config_files'] || '',
        services: [],
      })
    byProject.get(project).services.push({
      id: c.Id,
      name: L['com.docker.compose.service'] || c.Names?.[0]?.slice(1),
      state: c.State,
      status: c.Status,
      image: c.Image,
    })
  }
  return [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Run a compose operation for a project, streaming output to onChunk.
export function composeRun(project, action, { workingDir, files } = {}, onChunk) {
  return new Promise((resolve) => {
    let list = String(files || '')
      .split(':')
      .filter(Boolean)
      .map((f) => (f.startsWith('/') ? f : `${workingDir || '.'}/${f}`))
    const args = []
    if (list.length) args.push('-f', ...list)
    args.push('-p', project)
    if (action === 'down') args.push('down', '-v')
    else if (action === 'pull') args.push('pull')
    else args.push('up', '-d', '--remove-orphans')

    const child = spawn('docker', args, {
      cwd: workingDir || undefined,
      env: { ...process.env, COMPOSE_ANSI: 'never' },
    })
    const feed = (d) => onChunk?.(d.toString('utf8'))
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (e) => {
      onChunk?.(`\n[deck] ${e.message}\n`)
      resolve(127)
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

// ------------------------------------------------------------------ host run --
// Run a command on the HOST (as the deck user, no root). Used for the
// privacy panel probes (protonvpn status, curl, pgrep...).
export function hostRun(argv, { timeoutMs = 15000, env, onChunk } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let killed = false
    let settled = false
    let child
    try {
      child = spawn(argv[0], argv.slice(1), {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      return resolve({ exitCode: 127, output: String(e), killed: false })
    }
    const timer = setTimeout(() => {
      killed = true
      try {
        child.kill('SIGKILL')
      } catch {}
    }, timeoutMs)
    const feed = (d) => {
      const t = d.toString('utf8')
      out += t
      if (out.length > 300000) out = out.slice(-300000)
      onChunk?.(t)
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const done = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code ?? (killed ? 124 : 1), output: out, killed })
    }
    child.on('close', done)
    child.on('error', (e) => {
      out += String(e)
      done(127)
    })
  })
}
