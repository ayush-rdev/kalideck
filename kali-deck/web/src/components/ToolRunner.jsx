// ToolRunner: run a catalog tool properly.
//
// Pick a recipe, fill the fields, see the exact command, then either stream it
// as a background job (live log, survives navigation) or open it in a
// terminal (for interactive tools: msfconsole, evil-winrm, bettercap...).
import { useEffect, useMemo, useState } from 'react'
import { api, cx } from '../lib/api.js'
import { toolkitFor, renderCommand, missingFields } from '../lib/toolkit.js'
import Icon from '../components/Icon.jsx'
import LogConsole from '../components/LogConsole.jsx'
import { Pill, Spinner, useToast, CodeBlock } from '../components/ui.jsx'
import { useTerminals } from '../components/TerminalProvider.jsx'

const RISK = {
  passive: { kind: 'ok', label: 'passive' },
  active: { kind: 'warn', label: 'active' },
  intrusive: { kind: 'danger', label: 'intrusive' },
}

export default function ToolRunner({ tool, defaultTab = 'run', onClose, onInstall, installing }) {
  const [tab, setTab] = useState(defaultTab)
  const [recipeIdx, setRecipeIdx] = useState(0)
  const [values, setValues] = useState({})
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { openTerminal } = useTerminals()

  const tk = useMemo(() => toolkitFor(tool), [tool])
  const recipes = tk.recipes || []
  const recipe = recipes[recipeIdx] || recipes[0]

  // seed field defaults whenever the recipe changes
  useEffect(() => {
    const seed = {}
    for (const f of recipe?.fields || []) seed[f.k] = f.def ?? ''
    setValues(seed)
    setJob(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeIdx, tool.id])

  const cmd = recipe ? renderCommand(recipe.cmd, values) : ''
  const missing = recipe ? missingFields(recipe, values) : []
  const canRun = recipe && missing.length === 0

  const runJob = async () => {
    if (!canRun) return
    setBusy(true)
    try {
      const { jobId } = await api('/api/run', {
        method: 'POST',
        body: { cmd, timeoutMs: 30 * 60 * 1000 },
      })
      setJob({ id: jobId, cmd })
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const runTerminal = () => {
    if (!canRun) return
    openTerminal({
      title: tool.name,
      preset: 'cmd',
      cmd,
      // newline makes the PTY actually execute it once the shell is ready
      input: '\n',
    })
    onClose?.()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd)
      toast('command copied', 'ok')
    } catch {
      toast('clipboard blocked by the browser', 'error')
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[560px] bg-panel border-l border-line2 flex flex-col fade-in">
        {/* header */}
        <div className="flex items-center gap-2 h-12 px-4 border-b border-line shrink-0">
          <span className="font-mono text-[14px] font-semibold flex-1 truncate">
            {tool.name}
          </span>
          {tk.generated && <Pill kind="neutral">generic</Pill>}
          <Pill kind={tool.installed ? 'ok' : 'danger'}>
            {tool.installed ? 'installed' : 'missing'}
          </Pill>
          <button className="btn !p-1.5" onClick={onClose} aria-label="close">
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-line shrink-0">
          {[
            ['run', 'Run'],
            ['guide', 'Guide'],
          ].map(([k, l]) => (
            <button
              key={k}
              className={cx('btn', tab === k && 'btn-primary')}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
          <span className="ml-auto self-center font-mono text-[10.5px] text-dim">
            {recipes.length} recipe{recipes.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'guide' ? (
            <Guide tk={tk} tool={tool} />
          ) : (
            <div className="p-4 space-y-4">
              {!tool.installed && (
                <div className="flex items-center gap-2">
                  <Pill kind="warn">not installed</Pill>
                  <button
                    className="btn btn-primary"
                    onClick={onInstall}
                    disabled={installing}
                  >
                    {installing ? <Spinner size={12} /> : <Icon name="download" size={12} />}
                    Install now
                  </button>
                </div>
              )}

              {/* recipe picker */}
              <div className="space-y-1.5">
                <div className="label">recipes</div>
                {recipes.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setRecipeIdx(i)}
                    className={cx(
                      'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                      i === recipeIdx
                        ? 'border-accent/50 bg-accent/5'
                        : 'border-line hover:border-line2'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-medium flex-1 truncate">
                        {r.name}
                      </span>
                      {r.risk && (
                        <span
                          className={cx(
                            'text-[9.5px] font-mono uppercase tracking-wider',
                            r.risk === 'passive'
                              ? 'text-accent'
                              : r.risk === 'active'
                                ? 'text-warn'
                                : 'text-danger'
                          )}
                        >
                          {RISK[r.risk]?.label || r.risk}
                        </span>
                      )}
                      {r.interactive && <Pill kind="info">interactive</Pill>}
                    </div>
                    {r.desc && (
                      <div className="text-[11.5px] text-dim mt-0.5 leading-snug">
                        {r.desc}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* fields */}
              {(recipe?.fields || []).length > 0 && (
                <div className="space-y-2.5">
                  <div className="label">inputs</div>
                  {recipe.fields.map((f) => (
                    <label key={f.k} className="block">
                      <span className="label block mb-1">
                        {f.label}
                        {f.required && <span className="text-danger"> *</span>}
                      </span>
                      <input
                        className="input font-mono"
                        type={f.secret ? 'password' : 'text'}
                        placeholder={f.ph || ''}
                        value={values[f.k] ?? ''}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.k]: e.target.value }))
                        }
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </label>
                  ))}
                </div>
              )}

              {/* preview */}
              <div>
                <div className="label mb-1.5">command</div>
                <div className="font-mono text-[12px] bg-ink border border-line rounded-lg px-3 py-2 break-all leading-relaxed">
                  <span className="text-accent select-none">$ </span>
                  {cmd.split(/(«\w+»)/).map((part, i) =>
                    /^«\w+»$/.test(part) ? (
                      <span key={i} className="text-warn">
                        {part}
                      </span>
                    ) : (
                      <span key={i}>{part}</span>
                    )
                  )}
                </div>
                {missing.length > 0 && (
                  <div className="text-[11.5px] text-warn mt-1.5 flex items-center gap-1.5">
                    <Icon name="alert" size={12} /> fill: {missing.join(', ')}
                  </div>
                )}
              </div>

              {/* actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary flex-1 !min-h-[40px]"
                  disabled={!canRun || !tool.installed || busy}
                  onClick={runJob}
                  title="Stream output here as a background job"
                >
                  {busy ? <Spinner size={13} /> : <Icon name="play" size={13} />}
                  Run here
                </button>
                <button
                  className="btn flex-1 !min-h-[40px]"
                  disabled={!canRun || !tool.installed}
                  onClick={runTerminal}
                  title="Open in a full terminal"
                >
                  <Icon name="terminal" size={13} /> Terminal
                </button>
                <button className="btn !min-h-[40px]" onClick={copy} title="Copy command">
                  <Icon name="copy" size={13} />
                </button>
              </div>

              {recipe?.interactive && (
                <div className="text-[11.5px] text-dim leading-relaxed">
                  This tool expects a TTY - use <b>Terminal</b> for the real
                  interactive experience.
                </div>
              )}

              {recipe?.risk === 'intrusive' && (
                <div className="text-[11.5px] text-warn leading-relaxed flex gap-1.5">
                  <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
                  Intrusive: heavy traffic or potential service disruption. Only
                  run against systems you are authorised to test.
                </div>
              )}

              {/* live output */}
              {job && (
                <div className="pt-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="label flex-1">output</span>
                    <button className="btn !py-0.5 !px-2" onClick={() => setJob(null)}>
                      clear
                    </button>
                  </div>
                  <LogConsole jobId={job.id} height="h-64" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Guide({ tk, tool }) {
  return (
    <div className="p-4 space-y-4">
      <p className="text-[13px] text-dim leading-relaxed whitespace-pre-line">
        {tk.about}
      </p>

      {tk.when?.length > 0 && (
        <div>
          <div className="label mb-1.5">use it when</div>
          <ul className="space-y-1.5">
            {tk.when.map((w, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] text-dim leading-snug">
                <Icon name="check" size={13} className="text-accent mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tk.flags?.length > 0 && (
        <div>
          <div className="label mb-1.5">flags that matter</div>
          <div className="rounded-lg border border-line overflow-hidden">
            {tk.flags.map(([f, d], i) => (
              <div
                key={i}
                className={cx(
                  'flex gap-3 px-3 py-1.5 text-[12px]',
                  i % 2 ? 'bg-panel2/40' : ''
                )}
              >
                <span className="font-mono text-accent2 w-[110px] shrink-0 break-all">
                  {f}
                </span>
                <span className="text-dim leading-snug">{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tk.recipes?.length > 0 && (
        <div>
          <div className="label mb-1.5">example commands</div>
          <div className="space-y-2">
            {tk.recipes.map((r, i) => (
              <div key={i}>
                <div className="text-[12px] mb-1">{r.name}</div>
                <CodeBlock>{r.cmd}</CodeBlock>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 text-[12px]">
        <div className="flex gap-2">
          <span className="label w-20 shrink-0 pt-0.5">binary</span>
          <span className="font-mono text-accent2">{tool.bin || tool.id}</span>
        </div>
        <div className="flex gap-2">
          <span className="label w-20 shrink-0 pt-0.5">category</span>
          <span className="text-dim">{tool.cat}</span>
        </div>
      </div>

      {tk.docs && (
        <a
          className="btn inline-flex"
          href={tk.docs}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="external" size={12} /> Official documentation
        </a>
      )}
    </div>
  )
}
