// Terminal tab state: pages call openTerminal() to spawn/foreground a
// session, the Terminals page renders them. Session ids survive tab
// switches so switching back reattaches with scrollback replay.
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { go } from '../lib/hooks.js'

const TermCtx = createContext(null)

export function TerminalProvider({ children }) {
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)

  const openTerminal = useCallback(
    ({ title, preset = 'shell', cmd = '', input = '' }) => {
      let id = null
      setTabs((prev) => {
        // focus an identical idle tab instead of duplicating
        const dup = prev.find(
          (t) => t.preset === preset && t.cmd === cmd && !t.closed
        )
        if (dup) {
          id = dup.id
          return prev
        }
        id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        return [
          ...prev,
          {
            id,
            title: title || (preset === 'cmd' ? cmd.slice(0, 28) || 'shell' : preset),
            preset,
            cmd,
            input,
            termId: null,
            inputSent: false,
          },
        ]
      })
      // setActive after state settles: use the computed id via microtask
      queueMicrotask(() => {
        if (id) setActiveId(id)
        go('/terminals')
      })
      return id
    },
    []
  )

  const closeTab = useCallback((id) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id)
      setActiveId((cur) => {
        if (cur !== id) return cur
        return next.length ? next[next.length - 1].id : null
      })
      return next
    })
  }, [])

  const patchTab = useCallback((id, patch) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const value = useMemo(
    () => ({ tabs, activeId, setActiveId, openTerminal, closeTab, patchTab }),
    [tabs, activeId, openTerminal, closeTab, patchTab]
  )
  return <TermCtx.Provider value={value}>{children}</TermCtx.Provider>
}

export function useTerminals() {
  return useContext(TermCtx)
}
