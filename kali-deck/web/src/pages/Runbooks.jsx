// Runbooks: GUI forms that build tool commands and run them as jobs or in
// a real terminal. Values are validated, the command preview is live, and
// the Tor-route toggle from the privacy panel is honored.
import { useEffect, useMemo, useState } from 'react'
import { api, cx } from '../lib/api.js'
import { useHashRoute, go } from '../lib/hooks.js'
import Icon from '../components/Icon.jsx'
import {
  Card,
  Modal,
  Pill,
  Spinner,
  CodeBlock,
  useToast,
} from '../components/ui.jsx'
import LogConsole from '../components/LogConsole.jsx'
import { useTerminals } from '../components/TerminalProvider.jsx'
import {
  RUNBOOKS,
  defaultValues,
  missingRequired,
} from '../lib/runbooks.js'

function queryId(route) {
  const i = route.indexOf('?id=')
  return i === -1 ? null : route.slice(i + 4)
}

export default function Runbooks() {
  const route = useHashRoute()
  const [privacy, setPrivacy] = useState(null)
  const [q, setQ] = useState('')
  const openId = queryId(route)
  const toast = useToast()
  const { openTerminal } = useTerminals()

  useEffect(() => {
    api('/api/privacy').then(setPrivacy).catch(() => {})
  }, [])

  const visible = RUNBOOKS.filter(
    (r) =>
      !q.trim() ||
      r.name.toLowerCase().includes(q.toLowerCase()) ||
      r.desc.toLowerCase().includes(q.toLowerCase()) ||
      r.cat.includes(q.toLowerCase())
  )

  const open = openId ? RUNBOOKS.find((r) => r.id === openId) : null

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 sm:p-4 lg:p-5 max-w-[1300px] mx-auto pb-10">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Icon
              name="search"
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-dim"
            />
            <input
              className="input pl-9"
              placeholder="Search runbooks…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Pill kind={privacy?.torRoute ? 'ok' : 'neutral'}>
            {privacy?.torRoute ? 'via tor' : 'direct'}
          </Pill>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
          {visible.map((r) => (
            <button
              key={r.id}
              className="card p-3.5 text-left hover:border-accent/55 transition-colors group"
              onClick={() => go(`/runbooks?id=${r.id}`)}
            >
              <div className="flex items-start justify-between mb-2.5">
                <Icon
                  name={r.icon}
                  size={19}
                  className="text-dim group-hover:text-accent transition-colors"
                />
                <span className="label !text-[8.5px]">{r.cat}</span>
              </div>
              <div className="text-[13.5px] font-semibold truncate">{r.name}</div>
              <div className="text-[11.5px] text-dim leading-snug mt-1 line-clamp-2">
                {r.desc}
              </div>
            </button>
          ))}
        </div>

        {visible.length === 0 && (
          <div className="text-center text-dim text-[13px] py-16">no runbooks match</div>
        )}
      </div>

      {open && (
        <RunbookModal
          runbook={open}
          torRoute={!!privacy?.torRoute}
          onClose={() => go('/runbooks')}
          onTerminal={(cmd) => {
            openTerminal({ title: open.name, preset: 'cmd', cmd })
            go('/terminals')
          }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------- modal ---
function RunbookModal({ runbook: rb, torRoute, onClose, onTerminal }) {
  const [vals, setVals] = useState(() => defaultValues(rb))
  const [useTor, setUseTor] = useState(torRoute)
  const [job, setJob] = useState(null)
  const [running, setRunning] = useState(false)
  const [touched, setTouched] = useState(false)
  const toast = useToast()

  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }))

  const cmd = useMemo(() => {
    let built
    try {
      built = rb.build(vals)
    } catch {
      built = ''
    }
    return useTor && built ? `proxychains4 -q ${built}` : built
  }, [rb, vals, useTor])

  const invalid = missingRequired(rb, vals)

  const run = async () => {
    setTouched(true)
    if (invalid) return
    setRunning(true)
    try {
      const { jobId } = await api('/api/run', { method: 'POST', body: { cmd } })
      setJob(jobId)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={rb.name} wide className="max-h-[92vh]">
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* fields */}
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <Icon name={rb.icon} size={16} className="text-accent" />
            <span className="text-[13px] text-dim">{rb.desc}</span>
          </div>

          {rb.fields.map((f) => (
            <Field
              key={f.k}
              field={f}
              value={vals[f.k]}
              onChange={(v) => set(f.k, v)}
              invalid={touched && f.required && !String(vals[f.k] || '').trim()}
            />
          ))}

          <label className="flex items-center gap-2 text-[12.5px] cursor-pointer pt-1">
            <input
              type="checkbox"
              className="accent-[var(--color-accent)] h-3.5 w-3.5"
              checked={useTor}
              onChange={(e) => setUseTor(e.target.checked)}
            />
            Route through Tor{' '}
            <Pill kind={useTor ? 'ok' : 'neutral'}>{useTor ? 'proxychains' : 'direct'}</Pill>
          </label>
        </div>

        {/* preview + actions */}
        <div className="flex flex-col gap-3 min-w-0">
          <div className="label">command preview</div>
          <CodeBlock>{cmd || '…'}</CodeBlock>

          <div className="flex gap-2">
            <button
              className="btn btn-primary flex-1 !min-h-[42px]"
              disabled={running || !!job}
              onClick={run}
            >
              {running ? <Spinner size={14} /> : <Icon name="play" size={14} />}
              {job ? 'Running…' : 'Run'}
            </button>
            <button
              className="btn flex-1 !min-h-[42px]"
              disabled={invalid}
              onClick={() => {
                setTouched(true)
                if (!invalid) onTerminal(cmd)
              }}
            >
              <Icon name="terminal" size={14} /> Open in terminal
            </button>
          </div>
          {touched && invalid && (
            <div className="text-[12px] text-danger flex items-center gap-1.5">
              <Icon name="alert" size={13} /> required field missing
            </div>
          )}

          {job && (
            <div className="flex flex-col gap-2 flex-1 min-h-0">
              <div className="flex items-center justify-between">
                <span className="label">output</span>
                <button className="btn !py-1" onClick={() => setJob(null)}>
                  Clear
                </button>
              </div>
              <LogConsole jobId={job} height="h-72" />
            </div>
          )}

          <div className="text-[11px] text-dim leading-relaxed mt-auto">
            Runs inside <span className="font-mono text-accent2">kali-lab</span> as{' '}
            <span className="font-mono">hacker</span> in <span className="font-mono">/work</span>.
            For interactive tools prefer “Open in terminal”.
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------- field ---
function Field({ field: f, value, onChange, invalid }) {
  const label = (
    <label className="label block mb-1.5" htmlFor={`f-${f.k}`}>
      {f.label}
      {f.required && <span className="text-danger"> *</span>}
    </label>
  )

  if (f.type === 'check') {
    return (
      <label className="flex items-center gap-2.5 text-[13px] cursor-pointer select-none">
        <input
          type="checkbox"
          className="accent-[var(--color-accent)] h-4 w-4"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {f.label}
      </label>
    )
  }

  if (f.type === 'select') {
    return (
      <div>
        {label}
        <select
          id={`f-${f.k}`}
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {f.options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div>
      {label}
      <input
        id={`f-${f.k}`}
        className={cx('input font-mono', invalid && '!border-danger')}
        type="text"
        value={value}
        placeholder={f.placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {invalid && <div className="text-[11px] text-danger mt-1">required</div>}
    </div>
  )
}
