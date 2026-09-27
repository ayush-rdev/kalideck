// API client + small formatting helpers.
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new ApiError('network error - is the deck running?', 0)
  }
  if (res.status === 401) {
    window.dispatchEvent(new Event('deck:unauthorized'))
    throw new ApiError('unauthorized', 401)
  }
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status, data)
  }
  return data
}

export function wsUrl(path, params = {}) {
  const u = new URL(path, location.origin)
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

export const cx = (...a) => a.filter(Boolean).join(' ')

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
export function fmtBytes(n) {
  if (!n && n !== 0) return '-'
  let v = Number(n)
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${UNITS[i]}`
}

export function fmtRate(bytesPerSec) {
  if (!bytesPerSec) return '0 B/s'
  return `${fmtBytes(bytesPerSec)}/s`
}

export function fmtDuration(sec) {
  sec = Math.floor(sec || 0)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec % 60}s`
  return `${sec}s`
}

export function fmtAgo(ts) {
  if (!ts) return '-'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
