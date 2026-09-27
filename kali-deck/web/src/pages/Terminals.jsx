// Terminal sessions: tabbed xterm.js PTYs into kali-lab.
import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import TerminalView from '../components/TerminalView.jsx'
import { cx } from '../lib/api.js'
import { useTerminals } from '../components/TerminalProvider.jsx'
import { EmptyState } from '../components/ui.jsx'

const PRESETS = [
  { preset: 'shell', label: 'Shell', icon: 'terminal', hint: 'zsh as hacker' },
  { preset: 'root', label: 'Root', icon: 'lock', hint: 'zsh as root' },
  { preset: 'tui', label: 'kali-tui', icon: 'layers', hint: 'tool manager TUI' },
  { preset: 'msf', label: 'Metasploit', icon: 'activity', hint: 'msfconsole' },
]

export default function Terminals() {
  const { tabs, activeId, setActiveId, openTerminal, closeTab } = useTerminals()
  const [adding, setAdding] = useState(false)
  const stripRef = useRef(null)
  const active = tabs.find((t) => t.id === activeId) || null

  // keep the active tab strip scrolled to the selected tab
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-active="1"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* tab strip */}
      <div className="shrink-0 border-b border-line bg-panel flex items-center gap-1 pl-1.5 pr-2 h-11">
        <div
          ref={stripRef}
          className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0 py-1.5"
        >
          {tabs.map((t) => (
            <div
              key={t.id}
              data-active={t.id === activeId ? '1' : '0'}
              className={cx(
                'group flex items-center gap-1.5 rounded-md border px-2.5 h-[28px] shrink-0 max-w-[180px] cursor-pointer transition-colors',
                t.id === activeId
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-line2 text-dim hover:text-txt'
              )}
              onClick={() => setActiveId(t.id)}
            >
              <Icon name="terminal" size={12} className="shrink-0" />
              <span className="font-mono text-[11.5px] truncate">{t.title}</span>
              <button
                className="opacity-50 hover:opacity-100 -mr-1"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
                aria-label="close tab"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>

        {/* new session menu */}
        <div className="relative shrink-0">
          <button className="btn !py-1" onClick={() => setAdding((a) => !a)}>
            <Icon name="plus" size={13} /> New
          </button>
          {adding && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAdding(false)} />
              <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 card border-line2 p-1.5 space-y-1 fade-in">
                {PRESETS.map((p) => (
                  <button
                    key={p.preset}
                    className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-panel2"
                    onClick={() => {
                      setAdding(false)
                      openTerminal({ title: p.label, preset: p.preset })
                    }}
                  >
                    <Icon name={p.icon} size={15} className="text-accent" />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{p.label}</span>
                      <span className="block text-[10.5px] text-dim">{p.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* session area */}
      <div className="flex-1 min-h-0">
        {active ? (
          <TerminalView key={active.id} tab={active} active />
        ) : (
          <EmptyState
            icon="terminal"
            title="No sessions yet"
            hint="Open a shell into kali-lab. Sessions keep running when you switch tabs - close the browser and you can reattach for five minutes."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.preset}
                    className={cx('btn', p.preset === 'shell' && 'btn-primary')}
                    onClick={() => openTerminal({ title: p.label, preset: p.preset })}
                  >
                    <Icon name={p.icon} size={14} />
                    {p.label}
                  </button>
                ))}
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}
