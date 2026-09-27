// Small React hooks: hash router, polling, media queries.
import { useEffect, useRef, useState } from 'react'

export const go = (route) => {
  location.hash = route
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/dashboard')
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || '/dashboard')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

// Poll `fn` every `ms`. Pauses when the tab is hidden, ticks immediately.
export function usePoll(fn, ms, { enabled = true } = {}) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return undefined
    let stop = false
    const tick = async () => {
      if (stop || document.hidden) return
      try {
        await ref.current()
      } catch {
        /* handled by caller state */
      }
    }
    tick()
    const id = setInterval(tick, ms)
    const onVis = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms, enabled])
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia !== 'undefined' ? matchMedia(query).matches : false
  )
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatches(mq.matches)
    mq.addEventListener('change', on)
    on()
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

// localStorage-backed state (fontSize, prefs).
export function useStored(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch {}
  }, [key, val])
  return [val, setVal]
}
