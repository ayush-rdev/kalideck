// App shell: desktop sidebar + topbar, mobile bottom nav + "More" sheet.
import { useState } from 'react'
import Icon from './Icon.jsx'
import { cx } from '../lib/api.js'
import { go, useHashRoute } from '../lib/hooks.js'
import { useTerminals } from './TerminalProvider.jsx'
import { api } from '../lib/api.js'

export const NAV = [
  { route: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { route: '/tools', label: 'Tools', icon: 'crosshair' },
  { route: '/library', label: 'Library', icon: 'layers' },
  { route: '/terminals', label: 'Terminals', icon: 'terminal' },
  { route: '/docker', label: 'Docker', icon: 'box' },
  { route: '/runbooks', label: 'Runbooks', icon: 'sliders' },
  { route: '/privacy', label: 'Privacy', icon: 'shield' },
]

// Keep the phone bottom bar to the four things you actually reach for;
// everything else lives behind "More".
const MOBILE_MAIN = ['/dashboard', '/tools', '/terminals', '/docker']
const MOBILE_MORE = NAV.filter((n) => !MOBILE_MAIN.includes(n.route))

const QUICK_LINKS = [
  { label: 'kali-tui (ttyd)', port: 7681 },
  { label: 'Homarr', port: 7575 },
  { label: 'Dockge', port: 3001 },
  { label: 'Cockpit', port: 9090 },
  { label: 'Tor Browser', port: 5800 },
]

const linkFor = (port) => `http://${location.hostname}:${port}/`

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 h-14 border-b border-line select-none">
      <span className="grid place-items-center h-8 w-8 rounded-lg border border-accent/50 bg-accent/10 text-accent font-mono font-bold text-[15px]">
        ◤
      </span>
      <div className="leading-none">
        <div className="font-mono font-bold tracking-[0.18em] text-[13px]">
          KALI<span className="text-accent">DECK</span>
        </div>
        <div className="label !text-[8.5px] mt-1">lab console</div>
      </div>
    </div>
  )
}

export default function Layout({ children, onLogout }) {
  const route = useHashRoute()
  const [sheet, setSheet] = useState(false)
  const { tabs } = useTerminals()
  const runningTabs = tabs.length

  const current = NAV.find((n) => route.startsWith(n.route)) || NAV[0]

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST' })
    } catch {}
    onLogout?.()
  }

  return (
    <div className="h-full flex bg-ink text-txt">
      {/* ---------------------------------------------------- desktop rail */}
      <aside className="hidden lg:flex w-[218px] shrink-0 flex-col border-r border-line bg-panel">
        <Brand />
        <nav className="flex-1 py-3 px-2.5 space-y-1">
          {NAV.map((n) => {
            const active = route.startsWith(n.route)
            return (
              <button
                key={n.route}
                onClick={() => go(n.route)}
                className={cx(
                  'w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] transition-colors',
                  active
                    ? 'bg-accent/12 text-accent border border-accent/35 font-medium'
                    : 'text-dim hover:text-txt hover:bg-panel2 border border-transparent'
                )}
              >
                <Icon name={n.icon} size={16} />
                <span className="flex-1 text-left">{n.label}</span>
                {n.route === '/terminals' && runningTabs > 0 && (
                  <span className="text-[10px] font-mono bg-accent/15 text-accent rounded-full px-1.5 py-px">
                    {runningTabs}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="p-3 border-t border-line space-y-1">
          <div className="label !text-[9px] mb-1.5">lab links</div>
          {QUICK_LINKS.map((l) => (
            <a
              key={l.port}
              href={linkFor(l.port)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-[12px] text-dim hover:text-accent2 px-1 py-0.5"
            >
              <Icon name="external" size={11} />
              {l.label}
            </a>
          ))}
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2.5 m-2.5 mt-0 rounded-lg px-3 py-2 text-[12.5px] text-dim hover:text-danger hover:bg-danger/10"
        >
          <Icon name="logout" size={15} /> Sign out
        </button>
      </aside>

      {/* ---------------------------------------------------------- content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-3 h-12 px-3 border-b border-line bg-panel shrink-0">
          <span className="grid place-items-center h-7 w-7 rounded-md border border-accent/50 bg-accent/10 text-accent font-mono text-[13px]">
            ◤
          </span>
          <span className="font-mono font-bold tracking-[0.16em] text-[12.5px]">
            KALI<span className="text-accent">DECK</span>
          </span>
          <span className="text-dim text-[11px] font-mono ml-auto truncate">
            {current.label}
          </span>
          <button onClick={logout} className="btn !p-1.5" title="Sign out">
            <Icon name="logout" size={14} />
          </button>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>

        {/* ------------------------------------------------- mobile bottom nav */}
        <nav
          className="lg:hidden shrink-0 border-t border-line bg-panel flex items-stretch"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV.filter((n) => MOBILE_MAIN.includes(n.route)).map((n) => {
            const active = route.startsWith(n.route)
            return (
              <button
                key={n.route}
                onClick={() => go(n.route)}
                className={cx(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[54px] relative',
                  active ? 'text-accent' : 'text-dim'
                )}
              >
                <Icon name={n.icon} size={19} />
                <span className="text-[9.5px] font-medium">{n.label}</span>
                {n.route === '/terminals' && runningTabs > 0 && (
                  <span className="absolute top-1 right-[22%] h-1.5 w-1.5 rounded-full bg-accent" />
                )}
                {active && (
                  <span className="absolute top-0 inset-x-5 h-[2px] bg-accent rounded-full" />
                )}
              </button>
            )
          })}
          <button
            onClick={() => setSheet(true)}
            className={cx(
              'flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[54px]',
              MOBILE_MORE.some((n) => route.startsWith(n.route))
                ? 'text-accent'
                : 'text-dim'
            )}
          >
            <Icon name="more" size={19} />
            <span className="text-[9.5px] font-medium">More</span>
          </button>
        </nav>
      </div>

      {/* ------------------------------------------------------- more sheet */}
      {sheet && (
        <div className="lg:hidden fixed inset-0 z-50 flex items-end" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="fade-in relative w-full bg-panel border-t border-line2 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between h-11 px-4 border-b border-line">
              <span className="label">more</span>
              <button className="btn !p-1.5" onClick={() => setSheet(false)}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {MOBILE_MORE.map((n) => (
                <button
                  key={n.route}
                  className="btn !min-h-[46px] justify-start"
                  onClick={() => {
                    go(n.route)
                    setSheet(false)
                  }}
                >
                  <Icon name={n.icon} size={16} /> {n.label}
                </button>
              ))}
              {QUICK_LINKS.map((l) => (
                <a
                  key={l.port}
                  className="btn !min-h-[46px] justify-start"
                  href={linkFor(l.port)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="external" size={14} /> {l.label}
                </a>
              ))}
              <button
                className="btn !min-h-[46px] justify-start text-danger"
                onClick={() => {
                  setSheet(false)
                  logout()
                }}
              >
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
