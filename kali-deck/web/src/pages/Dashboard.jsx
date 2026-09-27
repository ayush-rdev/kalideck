// Dashboard: host vitals, docker summary, service health, quick actions.
import { useState } from 'react'
import { api, fmtBytes, fmtRate, fmtDuration, cx } from '../lib/api.js'
import { usePoll, go } from '../lib/hooks.js'
import Icon from '../components/Icon.jsx'
import {
  Card,
  Ring,
  Meter,
  StatusDot,
  Pill,
  Spinner,
  ErrorBox,
} from '../components/ui.jsx'
import { useTerminals } from '../components/TerminalProvider.jsx'
import { RUNBOOKS } from '../lib/runbooks.js'

export default function Dashboard() {
  const [sys, setSys] = useState(null)
  const [err, setErr] = useState('')
  const { openTerminal } = useTerminals()

  usePoll(async () => {
    try {
      setSys(await api('/api/system'))
      setErr('')
    } catch (e) {
      if (e.status !== 401) setErr(e.message)
    }
  }, 3000)

  if (!sys && !err)
    return (
      <div className="h-full grid place-items-center text-dim">
        <Spinner size={22} />
      </div>
    )

  const mem = sys?.mem
  const memUsedPct = mem ? Math.round(((mem.total - mem.available) / mem.total) * 100) : 0
  const swapUsedPct =
    mem && mem.swapTotal ? Math.round(((mem.swapTotal - mem.swapFree) / mem.swapTotal) * 100) : 0
  const up = sys?.host?.uptime ?? 0
  const docker = sys?.docker || {}
  const services = sys?.services || {}
  const links = sys?.servicesInfo || []

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 sm:p-4 lg:p-5 space-y-4 max-w-[1500px] mx-auto pb-8">
        {err && <ErrorBox onRetry={() => setErr('')}>{err}</ErrorBox>}

        {/* ---------------------------------------------------------- vitals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* CPU */}
          <Card className="flex items-center gap-4">
            <Ring pct={sys?.cpu?.pct ?? 0}>
              <div>
                <div className="font-mono text-[17px] font-bold leading-none">
                  {sys?.cpu?.pct ?? 0}
                  <span className="text-[10px] text-dim">%</span>
                </div>
                <div className="label !text-[8px] mt-0.5">cpu</div>
              </div>
            </Ring>
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-4 gap-[3px] mb-2">
                {(sys?.cpu?.perCore || []).slice(0, 16).map((p, i) => (
                  <div
                    key={i}
                    className="h-[14px] rounded-[3px] bg-line overflow-hidden"
                    title={`core ${i}: ${p}%`}
                  >
                    <div
                      className="h-full bg-accent2/80"
                      style={{ width: `${p}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="text-[11.5px] text-dim font-mono truncate">
                {sys?.cpu?.cores} cores · load{' '}
                {(sys?.cpu?.load || []).map((l) => l.toFixed(2)).join(' ')}
              </div>
            </div>
          </Card>

          {/* MEM */}
          <Card>
            <div className="flex items-baseline justify-between mb-2">
              <span className="label">memory</span>
              <span className="font-mono text-[13px]">
                {fmtBytes((mem?.total ?? 0) - (mem?.available ?? 0))}
                <span className="text-dim"> / {fmtBytes(mem?.total)}</span>
              </span>
            </div>
            <Meter pct={memUsedPct} />
            <div className="flex justify-between mt-1.5 text-[11px] text-dim font-mono">
              <span>{memUsedPct}% used</span>
              <span>{fmtBytes(mem?.available)} free</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px]">
              <span className="label !text-[9px]">swap</span>
              <span className="font-mono text-dim">
                {fmtBytes((mem?.swapTotal ?? 0) - (mem?.swapFree ?? 0))} / {fmtBytes(mem?.swapTotal)}
              </span>
            </div>
            <Meter pct={swapUsedPct} color="var(--color-accent2)" className="mt-1" />
          </Card>

          {/* DISKS */}
          <Card>
            <div className="label mb-2.5">storage</div>
            <div className="space-y-3">
              {(sys?.disks || []).map((d) => (
                <div key={d.path}>
                  <div className="flex justify-between text-[11.5px] font-mono mb-1">
                    <span>{d.path}</span>
                    <span className="text-dim">
                      {fmtBytes(d.used)} / {fmtBytes(d.total)} · {d.pct}%
                    </span>
                  </div>
                  <Meter pct={d.pct} />
                </div>
              ))}
            </div>
          </Card>

          {/* NET */}
          <Card>
            <div className="label mb-2">network</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-dim text-[10.5px] font-mono uppercase tracking-wider">
                  <span className="text-accent">▼</span> down
                </div>
                <div className="font-mono text-[16.5px] font-semibold mt-0.5">
                  {fmtRate(sys?.net?.rxRate)}
                </div>
                <div className="text-[10.5px] text-dim font-mono mt-0.5">
                  {fmtBytes(sys?.net?.rx)} total
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-dim text-[10.5px] font-mono uppercase tracking-wider">
                  <span className="text-accent2">▲</span> up
                </div>
                <div className="font-mono text-[16.5px] font-semibold mt-0.5">
                  {fmtRate(sys?.net?.txRate)}
                </div>
                <div className="text-[10.5px] text-dim font-mono mt-0.5">
                  {fmtBytes(sys?.net?.tx)} total
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-line text-[11px] text-dim font-mono flex justify-between">
              <span>{sys?.host?.hostname}</span>
              <span>up {fmtDuration(up)}</span>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------- rows 2: services */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* services */}
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <span className="label">services</span>
              <Pill kind="ok">
                {links.filter((l) => services[l.id]?.up).length}/{links.length} up
              </Pill>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {links.map((l) => {
                const s = services[l.id]
                return (
                  <a
                    key={l.id}
                    href={`http://${location.hostname}:${l.port}/`}
                    target="_blank"
                    rel="noreferrer"
                    className={cx(
                      'group flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors min-w-0',
                      s?.up
                        ? 'border-line2 hover:border-accent/60 bg-panel2'
                        : 'border-line opacity-55'
                    )}
                  >
                    <StatusDot on={s?.up} />
                    <span className="text-[12.5px] truncate flex-1">{l.name}</span>
                    <span className="font-mono text-[10px] text-dim group-hover:text-accent2">
                      :{l.port}
                    </span>
                  </a>
                )
              })}
            </div>
          </Card>

          {/* docker + quick actions */}
          <Card>
            <div className="label mb-3">docker</div>
            <div className="flex items-center gap-4 mb-4">
              <div>
                <div className="font-mono text-[24px] font-bold leading-none text-accent">
                  {docker.running ?? 0}
                </div>
                <div className="label !text-[8.5px] mt-1">running</div>
              </div>
              <div className="text-line2 text-2xl font-light">/</div>
              <div>
                <div className="font-mono text-[24px] font-bold leading-none text-dim">
                  {docker.total ?? 0}
                </div>
                <div className="label !text-[8.5px] mt-1">total</div>
              </div>
              <button className="btn ml-auto" onClick={() => go('/docker')}>
                Manage <Icon name="chevron" size={12} />
              </button>
            </div>
            <div className="label mb-2">quick actions</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn justify-start"
                onClick={() => openTerminal({ title: 'shell', preset: 'shell' })}
              >
                <Icon name="terminal" size={14} /> New shell
              </button>
              <button
                className="btn justify-start"
                onClick={() => openTerminal({ title: 'kali-tui', preset: 'tui' })}
              >
                <Icon name="layers" size={14} /> kali-tui
              </button>
              <button className="btn justify-start" onClick={() => go('/tools')}>
                <Icon name="crosshair" size={14} /> Tools
              </button>
              <button className="btn justify-start" onClick={() => go('/runbooks')}>
                <Icon name="sliders" size={14} /> Runbooks
              </button>
            </div>
          </Card>
        </div>

        {/* -------------------------------------------------------- runbooks */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <span className="label">launch a tool</span>
            <button className="btn !py-1" onClick={() => go('/runbooks')}>
              all runbooks <Icon name="chevron" size={11} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
            {RUNBOOKS.slice(0, 7).map((r) => (
              <button
                key={r.id}
                className="card p-3 text-left hover:border-accent/50 transition-colors group"
                onClick={() => go(`/runbooks?id=${r.id}`)}
              >
                <Icon
                  name={r.icon}
                  size={17}
                  className="text-dim group-hover:text-accent mb-2"
                />
                <div className="text-[12.5px] font-medium truncate">{r.name}</div>
                <div className="text-[10.5px] text-dim truncate">{r.cat}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
