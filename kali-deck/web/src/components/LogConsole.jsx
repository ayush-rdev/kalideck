// Read-only xterm console attached to a backend job (/ws/job).
// Used for install logs, compose output, quick runs, container logs.
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api, wsUrl, cx } from '../lib/api.js'
import Icon from './Icon.jsx'
import { Pill, Spinner } from './ui.jsx'
import { useToast } from './ui.jsx'

const TERM_THEME = {
  background: '#05070b',
  foreground: '#c9d4e0',
  cursor: '#29e5b4',
  selectionBackground: '#29e5b440',
  black: '#0b1017',
  red: '#ff5d73',
  green: '#29e5b4',
  yellow: '#f5b944',
  blue: '#38bdf8',
  magenta: '#c084fc',
  cyan: '#67e8f9',
  white: '#d7e0ea',
}

export default function LogConsole({
  jobId,
  className,
  height = 'h-64',
  onStatus,
  autoScroll = true,
}) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)
  const linesRef = useRef([])
  const atBottomRef = useRef(true)
  const [status, setStatus] = useState('running')
  const [exitCode, setExitCode] = useState(null)
  const toast = useToast()

  // create xterm once
  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      convertEol: false,
      disableStdin: true,
      cursorBlink: false,
      scrollback: 20000,
      theme: TERM_THEME,
      allowTransparency: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    term.onScroll(() => {
      // approximate "at bottom" so we do not fight the user's scrolling
      const v = term.buffer.active.viewportY
      const base = term.buffer.active.length - term.rows
      atBottomRef.current = v >= base - 2
    })
    termRef.current = term
    fitRef.current = fit
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {}
    })

    const ro = new ResizeObserver(() => {
      clearTimeout(ro._t)
      ro._t = setTimeout(() => {
        try {
          fit.fit()
        } catch {}
      }, 90)
    })
    ro.observe(hostRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      term.dispose()
    }
  }, [])

  // attach to the job websocket
  useEffect(() => {
    if (!jobId || !termRef.current) return undefined
    const term = termRef.current
    linesRef.current = []
    const ws = new WebSocket(wsUrl('/ws/job', { job: jobId }))
    wsRef.current = ws

    const writeLines = (lines) => {
      if (!lines.length) return
      const keep = autoScroll && atBottomRef.current
      term.write(lines.map((l) => l + '\r\n').join(''))
      if (keep) term.scrollToBottom()
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.t === 'line') {
        linesRef.current.push(...msg.lines)
        if (linesRef.current.length > 20000)
          linesRef.current.splice(0, linesRef.current.length - 20000)
        writeLines(msg.lines)
      } else if (msg.t === 'status') {
        setStatus(msg.status)
        setExitCode(msg.exitCode)
        onStatus?.(msg.status, msg.exitCode)
        if (msg.status !== 'running') {
          setTimeout(() => ws.close(), 300)
        }
      } else if (msg.t === 'error') {
        setStatus('error')
        writeLines([`[deck] ${msg.error}`])
      }
    }
    ws.onerror = () => {}
    ws.onclose = () => {}

    return () => {
      try {
        ws.close()
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const running = status === 'running'

  return (
    <div className={cx('flex flex-col border border-line rounded-lg overflow-hidden bg-ink', className ?? height)}>
      <div className="flex items-center gap-2 h-9 px-3 border-b border-line bg-panel2 shrink-0">
        {running ? (
          <Spinner size={12} className="text-accent" />
        ) : (
          <Icon
            name={status === 'error' || (exitCode !== null && exitCode !== 0) ? 'alert' : 'check'}
            size={13}
            className={
              status === 'error' || (exitCode !== null && exitCode !== 0)
                ? 'text-danger'
                : 'text-accent'
            }
          />
        )}
        <span className="text-[11px] font-mono uppercase tracking-wider text-dim truncate flex-1">
          {running ? 'running' : status === 'aborted' ? 'aborted' : `exit ${exitCode ?? '?'}`}
        </span>
        {running && jobId && (
          <button
            className="btn !py-1 !px-2 text-danger"
            onClick={async () => {
              try {
                await api(`/api/jobs/${jobId}/abort`, { method: 'POST' })
              } catch (e) {
                toast(e.message, 'error')
              }
            }}
          >
            <Icon name="stop" size={11} /> Abort
          </button>
        )}
        <button
          className="btn !py-1 !px-2"
          title="Copy output"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(linesRef.current.join('\n'))
              toast('output copied', 'ok')
            } catch {
              toast('clipboard unavailable', 'error')
            }
          }}
        >
          <Icon name="copy" size={11} />
        </button>
        <button
          className="btn !py-1 !px-2"
          title="Scroll to end"
          onClick={() => termRef.current?.scrollToBottom()}
        >
          <Icon name="chevronDown" size={11} />
        </button>
      </div>
      <div ref={hostRef} className="xterm-host flex-1 min-h-0" />
    </div>
  )
}

export { TERM_THEME }
