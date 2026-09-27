// Background jobs: streaming log outputs (installs, compose runs, tool runs,
// container logs). Clients attach over /ws/job and can reconnect later -
// job output is kept for the lifetime of the process.
import crypto from 'node:crypto'

const jobs = new Map()
const MAX_JOBS = 60
const MAX_LINES = 4000

function pushLines(job, text) {
  const lines = text.split('\n')
  // keep the trailing partial line attached to the next chunk
  if (job.tail) {
    lines[0] = job.tail + lines[0]
    job.tail = ''
  }
  const last = lines.pop()
  // if the chunk did not end with a newline, remember the remainder
  if (!text.endsWith('\n')) {
    job.tail = last
    if (!lines.length) return
  }
  for (const line of lines) {
    job.lines.push(line)
  }
  if (job.lines.length > MAX_LINES) {
    const cut = job.lines.length - MAX_LINES
    job.lines.splice(0, cut)
    job.truncated = (job.truncated || 0) + cut
  }
  broadcast(job, { t: 'line', lines })
}

function broadcast(job, msg) {
  const raw = JSON.stringify(msg)
  for (const ws of job.subs) {
    try {
      if (ws.readyState === 1) ws.send(raw)
    } catch {}
  }
}

function setStatus(job, status, exitCode = null) {
  job.status = status
  job.exitCode = exitCode
  job.endedAt = status === 'running' ? null : Date.now()
  broadcast(job, { t: 'status', status, exitCode })
}

/**
 * createJob({ kind, title, follow, run })
 * run(emit, isAborted) -> Promise<number|null> (exit code)
 * follow jobs abort automatically when the last subscriber leaves
 * (live log streams). install/compose jobs keep running in background.
 */
export function createJob({ kind = 'run', title = 'job', follow = false, run }) {
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    kind,
    title,
    follow,
    status: 'running',
    exitCode: null,
    lines: [],
    tail: '',
    truncated: 0,
    createdAt: Date.now(),
    endedAt: null,
    subs: new Set(),
    aborted: false,
    abortFns: [],
    run,
  }
  jobs.set(job.id, job)

  const emit = (chunk) => {
    if (typeof chunk === 'string' && chunk) pushLines(job, chunk)
  }

  Promise.resolve()
    .then(() => run(emit, () => job.aborted))
    .then((code) => {
      if (job.tail) pushLines(job, job.tail + '\n')
      if (!job.aborted) setStatus(job, 'done', code ?? 0)
      else setStatus(job, 'aborted', code ?? 130)
    })
    .catch((e) => {
      pushLines(job, `\n[deck] job failed: ${e?.message || e}\n`)
      setStatus(job, 'error', 1)
    })
    .finally(() => trimJobs())

  return job
}

function trimJobs() {
  if (jobs.size <= MAX_JOBS) return
  const done = [...jobs.values()]
    .filter((j) => j.status !== 'running')
    .sort((a, b) => a.createdAt - b.createdAt)
  while (jobs.size > MAX_JOBS && done.length) {
    const victim = done.shift()
    if (victim.subs.size === 0) jobs.delete(victim.id)
  }
}

export const getJob = (id) => jobs.get(id) || null

export function abortJob(job) {
  if (!job || job.status !== 'running') return
  job.aborted = true
  for (const fn of job.abortFns) {
    try {
      fn()
    } catch {}
  }
}

export function attachJob(job, ws) {
  job.subs.add(ws)
  ws.send(
    JSON.stringify({
      t: 'open',
      job: {
        id: job.id,
        kind: job.kind,
        title: job.title,
        status: job.status,
        createdAt: job.createdAt,
        truncated: job.truncated,
      },
    })
  )
  if (job.lines.length) ws.send(JSON.stringify({ t: 'line', lines: job.lines }))
  ws.send(
    JSON.stringify({
      t: 'status',
      status: job.status,
      exitCode: job.exitCode,
    })
  )

  const cleanup = () => {
    job.subs.delete(ws)
    // live streams (follow) die with their last viewer
    if (job.follow && job.subs.size === 0) abortJob(job)
  }
  ws.on('close', cleanup)
  ws.on('error', cleanup)
}
