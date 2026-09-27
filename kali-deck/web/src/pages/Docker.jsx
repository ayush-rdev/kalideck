// Docker: container grid with lifecycle actions, live logs, compose stacks,
// images. (Dockge stays the compose-file editor - this is the quick panel.)
import { useEffect, useState } from 'react'
import { api, cx, fmtBytes, fmtAgo } from '../lib/api.js'
import { usePoll } from '../lib/hooks.js'
import Icon from '../components/Icon.jsx'
import {
  Card,
  Pill,
  Spinner,
  ErrorBox,
  Modal,
  EmptyState,
  useToast,
} from '../components/ui.jsx'
import LogConsole from '../components/LogConsole.jsx'

const TABS = [
  { id: 'containers', label: 'Containers', icon: 'box' },
  { id: 'stacks', label: 'Stacks', icon: 'layers' },
  { id: 'images', label: 'Images', icon: 'image' },
]

export default function Docker() {
  const [tab, setTab] = useState('containers')
  const [containers, setContainers] = useState(null)
  const [stacks, setStacks] = useState(null)
  const [images, setImages] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [logs, setLogs] = useState(null) // { id, name, tail, follow }
  const [compose, setCompose] = useState(null) // { jobId, label }
  const toast = useToast()

  const loadContainers = async (quiet) => {
    try {
      const d = await api('/api/docker/containers')
      setContainers(d.containers)
      setErr('')
      if (!quiet) return
    } catch (e) {
      if (e.status !== 401 && !quiet) setErr(e.message)
    }
  }
  const loadStacks = async () => {
    try {
      const d = await api('/api/docker/stacks')
      setStacks(d.stacks)
    } catch {}
  }
  const loadImages = async () => {
    try {
      const d = await api('/api/docker/images')
      setImages(d.images)
    } catch {}
  }

  useEffect(() => {
    loadContainers()
    loadStacks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  usePoll(() => loadContainers(true), 8000, { enabled: tab === 'containers' })
  usePoll(() => loadStacks(), 15000, { enabled: tab === 'stacks' })

  const action = async (id, act, label) => {
    if (act === 'remove' && !window.confirm(`Remove container ${label}? It will be deleted.`))
      return
    setBusy(`${id}:${act}`)
    try {
      await api(`/api/docker/containers/${id}/${act}`, { method: 'POST' })
      toast(`${label}: ${act} ok`, 'ok')
      setTimeout(() => loadContainers(true), 600)
    } catch (e) {
      toast(`${label}: ${e.message}`, 'error')
    } finally {
      setBusy('')
    }
  }

  const openLogs = async (c, tail = 300, follow = true) => {
    try {
      const name = (c.Names?.[0] || c.Id).replace(/^\//, '')
      const { jobId } = await api(
        `/api/docker/containers/${c.Id}/logs?tail=${tail}&follow=${follow ? 1 : 0}`
      )
      setLogs({ jobId, name, containerId: c.Id, tail, follow })
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const composeAction = async (project, act) => {
    if (act === 'down' && !window.confirm(`Tear down stack "${project}" (with volumes)?`))
      return
    try {
      const { jobId } = await api(`/api/docker/stacks/${project}/${act}`, {
        method: 'POST',
      })
      setCompose({ jobId, label: `compose ${act}: ${project}` })
      setTimeout(() => {
        loadStacks()
        loadContainers(true)
      }, 2500)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const running = (containers || []).filter((c) => c.State === 'running').length

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* tabs */}
      <div className="shrink-0 border-b border-line bg-panel/60 backdrop-blur px-3 sm:px-4 pt-3 pb-0">
        <div className="flex items-center gap-1.5 max-w-[1500px] mx-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={cx(
                'flex items-center gap-1.5 px-3 py-2 text-[12.5px] border-b-2 -mb-px transition-colors',
                tab === t.id
                  ? 'border-accent text-accent font-medium'
                  : 'border-transparent text-dim hover:text-txt'
              )}
              onClick={() => {
                setTab(t.id)
                if (t.id === 'images' && !images) loadImages()
                if (t.id === 'stacks' && !stacks) loadStacks()
              }}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-2">
            {containers && (
              <span className="hidden sm:inline font-mono text-[11px] text-dim">
                <span className="text-accent">{running}</span> running / {containers.length}
              </span>
            )}
            <button className="btn !py-1 !px-2" onClick={() => loadContainers(true)}>
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto p-3 sm:p-4 pb-10 space-y-3">
          {err && <ErrorBox onRetry={() => loadContainers()}>{err}</ErrorBox>}

          {/* ------------------------------------------------------ containers */}
          {tab === 'containers' &&
            (!containers ? (
              <div className="py-20 grid place-items-center text-dim">
                <Spinner size={22} />
              </div>
            ) : containers.length === 0 ? (
              <EmptyState icon="box" title="No containers" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {containers.map((c) => {
                  const name = (c.Names?.[0] || c.Id).replace(/^\//, '')
                  const isRun = c.State === 'running'
                  const unhealthy = (c.Status || '').includes('(unhealthy)')
                  const project = c.Labels?.['com.docker.compose.project']
                  const thisBusy = busy.startsWith(`${c.Id}:`)
                  return (
                    <Card key={c.Id} className="flex flex-col gap-2.5 !p-3.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span
                          className={cx(
                            'mt-1.5 h-2 w-2 rounded-full shrink-0',
                            unhealthy
                              ? 'bg-danger shadow-[0_0_6px_var(--color-danger)]'
                              : isRun
                                ? 'bg-accent shadow-[0_0_6px_var(--color-accent)]'
                                : 'bg-line2'
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[13.5px] font-semibold truncate">
                              {name}
                            </span>
                            {project && <Pill className="hidden sm:inline-flex">{project}</Pill>}
                          </div>
                          <div className="text-[11.5px] text-dim truncate font-mono">
                            {c.Image}
                          </div>
                          <div className="text-[11px] text-dim mt-0.5 truncate">
                            {c.Status}
                            {c.Ports?.length > 0 && (
                              <span className="font-mono">
                                {' '}
                                ·{' '}
                                {c.Ports.map(
                                  (p) =>
                                    `${p.PrivatePort}${p.PublicPort ? `→${p.PublicPort}` : ''}`
                                ).join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <Pill kind={unhealthy ? 'danger' : isRun ? 'ok' : 'neutral'}>
                          {c.State}
                        </Pill>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          className="btn !py-1"
                          disabled={thisBusy || isRun}
                          onClick={() => action(c.Id, 'start', name)}
                        >
                          <Icon name="play" size={12} /> Start
                        </button>
                        <button
                          className="btn !py-1"
                          disabled={thisBusy || !isRun}
                          onClick={() => action(c.Id, 'stop', name)}
                        >
                          <Icon name="stop" size={12} /> Stop
                        </button>
                        <button
                          className="btn !py-1"
                          disabled={thisBusy || !isRun}
                          onClick={() => action(c.Id, 'restart', name)}
                        >
                          <Icon name="refresh" size={12} /> Restart
                        </button>
                        <button
                          className="btn !py-1"
                          onClick={() => openLogs(c)}
                        >
                          <Icon name="terminal" size={12} /> Logs
                        </button>
                        <button
                          className="btn !py-1 !px-2 ml-auto text-danger"
                          disabled={thisBusy}
                          title="Remove container"
                          onClick={() => action(c.Id, 'remove', name)}
                        >
                          {thisBusy ? <Spinner size={11} /> : <Icon name="trash" size={12} />}
                        </button>
                      </div>
                    </Card>
                  )
                })}
              </div>
            ))}

          {/* ---------------------------------------------------------- stacks */}
          {tab === 'stacks' &&
            (!stacks ? (
              <div className="py-20 grid place-items-center text-dim">
                <Spinner size={22} />
              </div>
            ) : (
              <div className="space-y-3">
                {stacks.map((s) => (
                  <Card key={s.name} className="!p-3.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon name="layers" size={15} className="text-accent2" />
                          <span className="font-mono text-[13.5px] font-semibold">{s.name}</span>
                          <Pill kind={s.services.every((x) => x.state === 'running') ? 'ok' : 'warn'}>
                            {s.services.filter((x) => x.state === 'running').length}/
                            {s.services.length} up
                          </Pill>
                        </div>
                        <div className="text-[11px] text-dim font-mono truncate mt-1">
                          {s.workingDir}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {s.services.map((sv) => (
                            <span
                              key={sv.id}
                              className="inline-flex items-center gap-1.5 rounded border border-line2 px-2 py-0.5 text-[11px] font-mono"
                            >
                              <span
                                className={cx(
                                  'h-1.5 w-1.5 rounded-full',
                                  sv.state === 'running' ? 'bg-accent' : 'bg-line2'
                                )}
                              />
                              {sv.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn !py-1.5"
                          onClick={() => composeAction(s.name, 'up')}
                        >
                          <Icon name="play" size={12} /> Up
                        </button>
                        <button
                          className="btn !py-1.5"
                          onClick={() => composeAction(s.name, 'pull')}
                        >
                          <Icon name="download" size={12} /> Pull
                        </button>
                        <button
                          className="btn !py-1.5 btn-danger"
                          onClick={() => composeAction(s.name, 'down')}
                        >
                          <Icon name="stop" size={12} /> Down
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ))}

          {/* ---------------------------------------------------------- images */}
          {tab === 'images' &&
            (!images ? (
              <div className="py-20 grid place-items-center text-dim">
                <Spinner size={22} />
              </div>
            ) : (
              <div className="card divide-y divide-line overflow-hidden">
                {images
                  .slice()
                  .sort((a, b) => (b.Created || 0) - (a.Created || 0))
                  .map((im) => {
                    const tag = (im.RepoTags || [im.Id.slice(7, 19)]).join(', ')
                    return (
                      <div
                        key={im.Id}
                        className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px]"
                      >
                        <Icon name="image" size={14} className="text-dim shrink-0" />
                        <span className="font-mono truncate flex-1">{tag}</span>
                        <span className="font-mono text-dim shrink-0">
                          {fmtBytes(im.Size)}
                        </span>
                        <span className="hidden sm:block text-dim shrink-0 w-24 text-right">
                          {fmtAgo((im.Created || 0) * 1000)}
                        </span>
                      </div>
                    )
                  })}
              </div>
            ))}
        </div>
      </div>

      {/* container logs modal */}
      {logs && (
        <Modal
          open
          wide
          onClose={() => setLogs(null)}
          title={`logs · ${logs.name}`}
          className="h-[75vh]"
        >
          <div className="p-3 flex flex-col h-full gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="label">tail</span>
              {[100, 300, 1000].map((t) => (
                <button
                  key={t}
                  className={cx('btn !py-1', logs.tail === t && 'btn-primary')}
                  onClick={() => {
                    setLogs({ ...logs, jobId: null, tail: t })
                    openLogs({ Id: logs.containerId, Names: [logs.name] }, t, logs.follow)
                  }}
                >
                  {t}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-[12px] text-dim ml-2">
                <input
                  type="checkbox"
                  className="accent-[var(--color-accent)]"
                  checked={logs.follow}
                  onChange={(e) => {
                    setLogs({ ...logs, jobId: null, follow: e.target.checked })
                    openLogs(
                      { Id: logs.containerId, Names: [logs.name] },
                      logs.tail,
                      e.target.checked
                    )
                  }}
                />
                follow
              </label>
            </div>
            {logs.jobId ? (
              <LogConsole
                key={logs.jobId}
                jobId={logs.jobId}
                className="flex-1 min-h-0 w-full"
                height=""
              />
            ) : (
              <div className="flex-1 grid place-items-center text-dim">
                <Spinner size={20} />
              </div>
            )}
            <div className="hidden sm:block text-[11px] text-dim">
              live stream via{' '}
              <span className="font-mono text-accent2">
                /api/docker/containers/:id/logs
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* compose output modal */}
      {compose && (
        <Modal open wide onClose={() => setCompose(null)} title={compose.label} className="h-[70vh]">
          <div className="p-3 h-full flex flex-col">
            <LogConsole jobId={compose.jobId} className="flex-1 min-h-0 w-full" height="" />
          </div>
        </Modal>
      )}
    </div>
  )
}
