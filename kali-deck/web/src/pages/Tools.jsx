// Tools: browse the kali-lab catalog, see install status, install with a live
// log, and run each tool through the recipe runner (see ToolRunner.jsx).
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, cx, wsUrl } from '../lib/api.js'
import { usePoll } from '../lib/hooks.js'
import Icon from '../components/Icon.jsx'
import { Pill, Spinner, ErrorBox, useToast } from '../components/ui.jsx'
import LogConsole from '../components/LogConsole.jsx'
import ToolRunner from '../components/ToolRunner.jsx'
import { hasGuide } from '../lib/toolkit.js'

const KIND_STYLE = {
  apt: 'text-accent2',
  go: 'text-accent',
  pipx: 'text-warn',
  pip: 'text-warn',
  gem: 'text-danger',
  cargo: 'text-warn',
  git: 'text-magenta',
  script: 'text-dim',
}

export default function Tools() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [runner, setRunner] = useState(null) // { tool, tab }
  const [job, setJob] = useState(null) // { id, label }
  const [busyId, setBusyId] = useState(null)
  const [logOpen, setLogOpen] = useState(true)
  const toast = useToast()
  const searchRef = useRef(null)

  const load = async (refresh = false) => {
    try {
      setData(await api(`/api/tools${refresh ? '?refresh=1' : ''}`))
      setErr('')
    } catch (e) {
      if (e.status !== 401) setErr(e.message)
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // poll only while no install job is streaming (job completion refreshes)
  usePoll(() => load(), 60000, { enabled: !!data })

  const tools = data?.tools || []
  const categories = data?.categories || []

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tools.filter((t) => {
      if (cat !== 'all' && t.cat !== cat) return false
      if (status === 'installed' && !t.installed) return false
      if (status === 'missing' && t.installed) return false
      if (!needle) return true
      return (
        t.id.includes(needle) ||
        t.name.toLowerCase().includes(needle) ||
        t.desc.toLowerCase().includes(needle) ||
        t.cat.includes(needle)
      )
    })
  }, [tools, q, cat, status])

  const installedCount = tools.filter((t) => t.installed).length

  const install = async (ids) => {
    if (!ids.length) return
    setBusyId(ids[0])
    try {
      const { jobId } = await api('/api/tools/install', {
        method: 'POST',
        body: { ids },
      })
      setJob({ id: jobId, label: `installing ${ids.length} tool${ids.length > 1 ? 's' : ''}` })
      setLogOpen(true)
      setSelected(new Set())
      watchJob(jobId)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const watchJob = (jobId) => {
    const ws = new WebSocket(wsUrl('/ws/job', { job: jobId }))
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data)
        if (m.t === 'status' && m.status !== 'running') {
          ws.close()
          load(true)
          toast(
            m.status === 'done'
              ? m.exitCode === 0
                ? 'install finished'
                : 'install finished with errors'
              : 'install stopped',
            m.status === 'done' && m.exitCode === 0 ? 'ok' : 'error'
          )
        }
      } catch {}
    }
    ws.onerror = () => {}
  }

  // Open the runner (recipe + fields + live output) instead of dumping the
  // bare binary name into a terminal, which just printed --help.
  const run = (tool) => setRunner({ tool, tab: 'run' })
  const guide = (tool) => setRunner({ tool, tab: 'guide' })

  if (!data && !err)
    return (
      <div className="h-full grid place-items-center text-dim">
        <Spinner size={22} />
      </div>
    )

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header ---------------------------------------------------------- */}
      <div className="shrink-0 border-b border-line bg-panel/60 backdrop-blur sticky top-0 z-20">
        <div className="px-3 sm:px-4 pt-3 pb-2 max-w-[1500px] mx-auto">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="relative flex-1 max-w-md">
              <Icon
                name="search"
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"
              />
              <input
                ref={searchRef}
                className="input pl-9"
                placeholder="Search 137 tools…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                type="search"
              />
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              {[
                ['all', 'All'],
                ['missing', 'Missing'],
                ['installed', 'Installed'],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={cx('btn', status === v && 'btn-primary')}
                  onClick={() => setStatus(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden sm:inline font-mono text-[11.5px] text-dim">
                <span className="text-accent">{installedCount}</span>/{tools.length} installed
              </span>
              <button
                className="btn !px-2"
                title="Re-probe status"
                onClick={() => {
                  load(true)
                  toast('status re-probed', 'ok')
                }}
              >
                <Icon name="refresh" size={13} />
              </button>
            </div>
          </div>

          {/* category chips */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
            <button
              className={cx('btn shrink-0', cat === 'all' && 'btn-primary')}
              onClick={() => setCat('all')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={cx('btn shrink-0', cat === c.id && 'btn-primary')}
                onClick={() => setCat(c.id)}
              >
                {c.name}
                <span className="font-mono text-[10px] text-dim">
                  {c.installed}/{c.total}
                </span>
              </button>
            ))}
            <button
              className="btn sm:hidden shrink-0"
              onClick={() =>
                setStatus((s) => (s === 'all' ? 'missing' : s === 'missing' ? 'installed' : 'all'))
              }
            >
              {status === 'all' ? 'Any status' : status === 'missing' ? 'Missing' : 'Installed'}
            </button>
          </div>
        </div>

        {/* bulk bar */}
        {selected.size > 0 && (
          <div className="border-t border-accent/30 bg-accent/10 px-3 sm:px-4 py-2 max-w-[1500px] mx-auto flex items-center gap-3">
            <span className="font-mono text-[12px] text-accent">
              {selected.size} selected
            </span>
            <button
              className="btn btn-primary"
              disabled={busyId !== null}
              onClick={() => install([...selected])}
            >
              <Icon name="download" size={13} /> Install selected
            </button>
            <button className="btn" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="p-3">
          <ErrorBox onRetry={() => load()}>{err}</ErrorBox>
        </div>
      )}

      {/* list ------------------------------------------------------------ */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto p-3 sm:p-4 pb-10">
          {data?.statusError && (
            <div className="mb-3">
              <Pill kind="warn">status probe failed - {data.statusError}</Pill>
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="text-center text-dim py-16 text-[13px]">
              nothing matches “{q || cat}”
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  className={cx(
                    'group flex items-center gap-2.5 rounded-lg border border-transparent hover:border-line2 hover:bg-panel px-2.5 py-2 -mx-0.5',
                    selected.has(t.id) && 'border-accent/40 bg-accent/5'
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)] h-3.5 w-3.5 shrink-0"
                    checked={selected.has(t.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        e.target.checked ? next.add(t.id) : next.delete(t.id)
                        return next
                      })
                    }
                    aria-label={`select ${t.name}`}
                  />
                  <span
                    className={cx(
                      'h-2 w-2 rounded-full shrink-0',
                      t.installed ? 'bg-accent' : 'bg-danger/70'
                    )}
                    title={t.installed ? 'installed' : 'missing'}
                  />
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => guide(t)}
                    title="Open the runner + in-depth guide"
                  >
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-[13px] font-medium truncate group-hover:text-accent transition-colors">
                        {t.name}
                      </span>
                      {hasGuide(t.id) && (
                        <span className="hidden sm:inline shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent2 border border-accent2/30 rounded px-1">
                          guide
                        </span>
                      )}
                      <span
                        className={cx(
                          'hidden sm:inline font-mono text-[9.5px] uppercase tracking-wider shrink-0',
                          KIND_STYLE[t.kind] || 'text-dim'
                        )}
                      >
                        {t.kind}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-dim truncate">{t.desc}</div>
                  </button>

                  {!t.installed && (
                    <button
                      className="btn btn-primary !py-1 shrink-0"
                      disabled={busyId !== null}
                      onClick={() => install([t.id])}
                    >
                      {busyId === t.id ? (
                        <Spinner size={11} />
                      ) : (
                        <Icon name="download" size={12} />
                      )}
                      <span className="hidden sm:inline">Install</span>
                    </button>
                  )}
                  <button
                    className="btn !py-1 shrink-0"
                    title="Open in terminal"
                    disabled={!t.installed}
                    onClick={() => run(t)}
                  >
                    <Icon name="play" size={12} />
                    <span className="hidden sm:inline">Run</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* install log drawer ---------------------------------------------- */}
      {job && (
        <div className="shrink-0 border-t border-line bg-panel p-2.5 sm:px-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 max-w-[1500px] mx-auto w-full">
            <span className="label flex-1 truncate">{job.label}</span>
            <button className="btn !py-1" onClick={() => setLogOpen((o) => !o)}>
              {logOpen ? 'Hide log' : 'Show log'}
            </button>
            <button className="btn !py-1 !px-2" onClick={() => setJob(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
          {logOpen && (
            <LogConsole jobId={job.id} height="h-44 sm:h-56" className="max-w-[1500px] mx-auto w-full" />
          )}
        </div>
      )}

      {/* runner + guide drawer ------------------------------------------- */}
      {runner && (
        <ToolRunner
          tool={runner.tool}
          defaultTab={runner.tab}
          onClose={() => setRunner(null)}
          onInstall={() => install([runner.tool.id])}
          installing={busyId === runner.tool.id}
        />
      )}
    </div>
  )
}
