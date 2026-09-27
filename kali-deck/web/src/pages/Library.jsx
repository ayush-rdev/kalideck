// Library: the in-depth guide for every tool - what it is for, the flags that
// matter, and example commands. Everything is also reachable from Tools; this
// page is for reading and learning rather than running.
import { useEffect, useMemo, useState } from 'react'
import { api, cx } from '../lib/api.js'
import { toolkitFor, hasGuide } from '../lib/toolkit.js'
import Icon from '../components/Icon.jsx'
import { Pill, Spinner, ErrorBox } from '../components/ui.jsx'
import ToolRunner from '../components/ToolRunner.jsx'

const RISK_STYLE = {
  passive: 'text-accent',
  active: 'text-warn',
  intrusive: 'text-danger',
}

export default function Library() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [showGeneric, setShowGeneric] = useState(false)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    api('/api/tools')
      .then(setData)
      .catch((e) => e.status !== 401 && setErr(e.message))
  }, [])

  const tools = data?.tools || []
  const categories = data?.categories || []

  const entries = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = tools
      .filter((t) => (showGeneric ? true : hasGuide(t.id)))
      .filter((t) => cat === 'all' || t.cat === cat)
      .map((t) => ({ tool: t, tk: toolkitFor(t) }))
    if (!needle) return list
    return list.filter(({ tool, tk }) => {
      const hay = `${tool.name} ${tool.id} ${tool.desc} ${tk.about} ${
        (tk.when || []).join(' ')
      }`.toLowerCase()
      return hay.includes(needle)
    })
  }, [tools, q, cat, showGeneric])

  const guidedTotal = tools.filter((t) => hasGuide(t.id)).length

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header */}
      <div className="shrink-0 border-b border-line bg-panel/60 backdrop-blur">
        <div className="px-3 sm:px-4 pt-3 pb-2 max-w-[1500px] mx-auto">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="relative flex-1 max-w-md">
              <Icon
                name="search"
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"
              />
              <input
                className="input pl-9"
                placeholder="Search the library…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                type="search"
              />
            </div>
            <label className="hidden sm:flex items-center gap-2 text-[12px] text-dim cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-[var(--color-accent)] h-3.5 w-3.5"
                checked={showGeneric}
                onChange={(e) => setShowGeneric(e.target.checked)}
              />
              include generic entries
            </label>
            <span className="hidden sm:inline ml-auto font-mono text-[11.5px] text-dim">
              <span className="text-accent2">{guidedTotal}</span>/{tools.length} with
              in-depth guides
            </span>
          </div>
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
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && (
        <div className="p-3">
          <ErrorBox onRetry={() => location.reload()}>{err}</ErrorBox>
        </div>
      )}

      {/* list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto p-3 sm:p-4 pb-10">
          {!data && !err ? (
            <div className="grid place-items-center py-20 text-dim">
              <Spinner size={22} />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center text-dim py-16 text-[13px]">
              nothing matches “{q || cat}”
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {entries.map(({ tool, tk }) => (
                <button
                  key={tool.id}
                  onClick={() => setOpen(tool)}
                  className="text-left card p-3 hover:border-accent/40 transition-colors flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[13px] font-semibold truncate">
                      {tool.name}
                    </span>
                    {!tk.generated && (
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent2 border border-accent2/30 rounded px-1">
                        guide
                      </span>
                    )}
                    <span className="ml-auto shrink-0">
                      <Pill kind={tool.installed ? 'ok' : 'danger'}>
                        {tool.installed ? 'ready' : 'missing'}
                      </Pill>
                    </span>
                  </div>

                  <p className="text-[12px] text-dim leading-relaxed line-clamp-3">
                    {tk.about}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono text-dim">
                    <span className="text-accent2">{tool.cat}</span>
                    {tk.flags?.length > 0 && <span>{tk.flags.length} flags</span>}
                    {tk.recipes?.length > 0 && <span>{tk.recipes.length} recipes</span>}
                    {tk.recipes?.[0]?.risk && (
                      <span className={RISK_STYLE[tk.recipes[0].risk]}>
                        {tk.recipes[0].risk}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <ToolRunner
          tool={open}
          defaultTab="guide"
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
