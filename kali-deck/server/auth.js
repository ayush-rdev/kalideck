// Password login + in-memory sessions.
import crypto from 'node:crypto'
import { config } from './config.js'

const sessions = new Map() // token -> { created, expires, ip }

const attempts = new Map() // ip -> { count, until }
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest()

function tooMany(ip) {
  const a = attempts.get(ip)
  return a && a.until > Date.now()
}

export function registerAttempt(ip, ok) {
  if (ok) {
    attempts.delete(ip)
    return
  }
  const a = attempts.get(ip) || { count: 0, until: 0 }
  a.count += 1
  if (a.count >= 5) {
    // 5 fails -> 10s lockout, doubling every further 5
    const lock = Math.min(10000 * 2 ** Math.floor((a.count - 5) / 5), 300000)
    a.until = Date.now() + lock
  }
  attempts.set(ip, a)
}

export const lockedOut = tooMany

export function verifyPassword(pw) {
  // constant-time compare on fixed-length digests
  const a = hash(pw ?? '')
  const b = hash(config.password)
  return crypto.timingSafeEqual(a, b)
}

export function createSession(ip) {
  const token = crypto.randomBytes(32).toString('hex')
  const session = {
    created: Date.now(),
    expires: Date.now() + config.sessionTtlMs,
    ip,
  }
  sessions.set(token, session)
  // opportunistic GC
  for (const [t, s] of sessions) if (s.expires < Date.now()) sessions.delete(t)
  return { token, session }
}

export function getSession(token) {
  const s = token && sessions.get(token)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return s
}

export function destroySession(token) {
  if (token) sessions.delete(token)
}

export function parseCookies(req) {
  const out = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function sessionToken(req) {
  return parseCookies(req).dk
}

export function sessionCookie(token) {
  return `dk=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    config.sessionTtlMs / 1000
  )}`
}

export const CLEAR_COOKIE = 'dk=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'

// Same-origin guard for state-changing API calls. Browsers always send
// Origin on cross-site POSTs; a missing Origin means non-browser client
// (curl etc) which we accept - the cookie itself is SameSite=Strict.
export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}
