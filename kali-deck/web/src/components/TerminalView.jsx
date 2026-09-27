// Interactive terminal: xterm.js <-> /ws/term (PTY inside kali-lab).
// - reconnects with scrollback replay via the backend session id
// - latched Ctrl key + arrow/slash keys for touch keyboards
// - font-size controls persisted to localStorage
import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api, wsUrl, cx } from '../lib/api.js'
import { useStored } from '../lib/hooks.js'
import Icon from './Icon.jsx'
import { TERM_THEME } from './LogConsole.jsx'
import { useTerminals } from './TerminalProvider.jsx'
import { useToast } from './ui.jsx'

const CTRL_CHARS = {
  ' ': '\x00',
  '?': '\x7f',
  '@': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
}

export default function TerminalView({ tab, active }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)
  const termIdRef = useRef(tab.termId)
  const ctrlRef = useRef(false)
  const [ctrlArmed, setCtrlArmed] = useState(false)
  const [status, setStatus] = useState('connecting') // connecting | ready | reconnect | exited
  const [fontSize, setFontSize] = useStored('deck.fontsize', 13)
  const { patchTab } = useTerminals()
  const toast = useToast()
  const inputSentRef = useRef(!!tab.inputSent)

  const send = useCallback((obj) => {
    const ws = wsRef.current
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
  }, [])

  // ---- create the xterm instance once per tab --------------------------
  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 8000,
      macOptionIsMeta: true,
      theme: TERM_THEME,
      allowTransparency: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit

    term.onData((d) => {
      let data = d
      if (ctrlRef.current && d.length === 1) {
        ctrlRef.current = false
        setCtrlArmed(false)
        const up = d.toUpperCase()
        data = CTRL_CHARS[d] ?? (/[a-zA-Z@]/.test(d) ? String.fromCharCode(up.charCodeAt(0) - 64) : d)
      }
      send({ t: 'in', d: data })
    })

    const raf = requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {}
    })
    return () => {
      cancelAnimationFrame(raf)
      try {
        wsRef.current?.close()
      } catch {}
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- (re)connect the websocket ---------------------------------------
  const connect = useCallback(() => {
    const term = termRef.current
    if (!term) return
    try {
      fitRef.current?.fit()
    } catch {}
    const cols = term.cols || 100
    const rows = term.rows || 30
    const params = termIdRef.current
      ? { term: termIdRef.current, cols, rows }
      : { preset: tab.preset, cmd: tab.cmd, cols, rows }
    if (termIdRef.current) params.term = termIdRef.current

    setStatus((s) => (s === 'ready' ? 'reconnect' : 'connecting'))
    const ws = new WebSocket(wsUrl('/ws/term', params))
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('ready')
      send({ t: 'resize', cols, rows })
      if (tab.input && !inputSentRef.current) {
        inputSentRef.current = true
        patchTab(tab.id, { inputSent: true })
        setTimeout(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', d: tab.input }))
          term.focus()
        }, 500)
      }
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        if (msg.t === 'ready') {
          termIdRef.current = msg.term
          patchTab(tab.id, { termId: msg.term })
        } else if (msg.t === 'exit') {
          setStatus('exited')
          term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
        } else if (msg.t === 'error') {
          setStatus('exited')
          term.write(`\r\n\x1b[31m[deck] ${msg.error}\x1b[0m\r\n`)
        }
        return
      }
      term.write(new Uint8Array(ev.data))
    }
    ws.onclose = () => {
      setStatus((s) => (s === 'exited' ? 'exited' : 'reconnect'))
    }
    ws.onerror = () => {}
  }, [tab, send, patchTab])

  useEffect(() => {
    connect()
    return () => {
      try {
        wsRef.current?.close()
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- fit on resize (only while visible) -------------------------------
  useEffect(() => {
    if (!active || !hostRef.current) return undefined
    let t
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        if (!termRef.current || !fitRef.current) return
        const before = { cols: termRef.current.cols, rows: termRef.current.rows }
        try {
          fitRef.current.fit()
        } catch {}
        if (before.cols !== termRef.current.cols || before.rows !== termRef.current.rows)
          send({
            t: 'resize',
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          })
      }, 90)
    })
    ro.observe(hostRef.current)
    const onWin = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        try {
          fitRef.current?.fit()
          send({ t: 'resize', cols: termRef.current.cols, rows: termRef.current.rows })
        } catch {}
      }, 120)
    }
    window.addEventListener('orientationchange', onWin)
    window.addEventListener('resize', onWin)
    return () => {
      clearTimeout(t)
      ro.disconnect()
      window.removeEventListener('orientationchange', onWin)
      window.removeEventListener('resize', onWin)
    }
  }, [active, send])

  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
    } catch {}
  }, [fontSize])

  const sendKeys = (s) => {
    send({ t: 'in', d: s })
    termRef.current?.focus()
  }

  const reconnect = () => {
    setStatus('connecting')
    connect()
  }

  if (!active) return null

  const toolbarBtn =
    'btn !min-h-[38px] !min-w-[38px] !px-2 font-mono text-[12px] select-none'

  return (
    <div className="flex flex-col h-full min-h-0 bg-ink">
      {/* status strip */}
      <div className="flex items-center gap-2 px-3 h-8 border-b border-line bg-panel shrink-0">
        <span
          className={cx(
            'h-2 w-2 rounded-full',
            status === 'ready'
              ? 'bg-accent shadow-[0_0_6px_var(--color-accent)]'
              : status === 'exited'
                ? 'bg-danger'
                : 'bg-warn animate-pulse'
          )}
        />
        <span className="font-mono text-[11px] text-dim truncate flex-1">
          {tab.title}
          <span className="text-line2"> · {status}</span>
        </span>
        <button
          className="btn !py-0.5 !px-2"
          onClick={() => {
            setFontSize((f) => Math.max(9, f - 1))
          }}
          title="Smaller text"
        >
          A-
        </button>
        <button
          className="btn !py-0.5 !px-2"
          onClick={() => {
            setFontSize((f) => Math.min(24, f + 1))
          }}
          title="Larger text"
        >
          A+
        </button>
        <button
          className="btn !py-0.5 !px-2"
          title="Restart session"
          onClick={() => {
            // spawn a brand-new PTY in place of the current one
            try {
              wsRef.current?.close()
            } catch {}
            termIdRef.current = null
            patchTab(tab.id, { termId: null, inputSent: true })
            termRef.current?.clear()
            reconnect()
          }}
        >
          <Icon name="refresh" size={12} />
        </button>
      </div>

      {/* terminal */}
      <div className="relative flex-1 min-h-0">
        <div ref={hostRef} className="xterm-host absolute inset-0" />
        {(status === 'connecting' || status === 'reconnect') && (
          <div className="absolute inset-0 grid place-items-center bg-ink/70 backdrop-blur-[1px]">
            <button className="btn btn-primary" onClick={reconnect}>
              <Icon name="refresh" size={14} />
              {status === 'connecting' ? 'Connecting…' : 'Reconnect'}
            </button>
          </div>
        )}
        {status === 'exited' && (
          <div className="absolute inset-x-0 bottom-0 p-3 flex justify-center">
            <button className="btn btn-primary" onClick={() => location.reload()}>
              <Icon name="refresh" size={14} /> New session
            </button>
          </div>
        )}
      </div>

      {/* mobile-friendly key bar */}
      <div className="shrink-0 border-t border-line bg-panel2 overflow-x-auto">
        <div className="flex items-center gap-1.5 px-2 py-1.5 min-w-max">
          <button
            className={cx(toolbarBtn, ctrlArmed && 'btn-primary !border-accent')}
            onClick={() => {
              ctrlRef.current = !ctrlRef.current
              setCtrlArmed((v) => !v)
            }}
          >
            Ctrl
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\x1b')}>
            Esc
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\t')}>
            Tab
          </button>
          <span className="w-px h-5 bg-line2 mx-0.5" />
          <button className={toolbarBtn} onClick={() => sendKeys('\x1b[A')}>
            ↑
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\x1b[B')}>
            ↓
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\x1b[D')}>
            ←
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\x1b[C')}>
            →
          </button>
          <span className="w-px h-5 bg-line2 mx-0.5" />
          <button className={toolbarBtn} onClick={() => sendKeys('\x03')}>
            ^C
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('\x04')}>
            ^D
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('/')}>
            /
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('|')}>
            |
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('-')}>
            -
          </button>
          <button className={toolbarBtn} onClick={() => sendKeys('~')}>
            ~
          </button>
          <span className="w-px h-5 bg-line2 mx-0.5" />
          <button
            className={toolbarBtn}
            onClick={() => {
              termRef.current?.focus()
              toast('keyboard focused - type in the terminal', 'info')
            }}
            title="Open keyboard"
          >
            ⌨
          </button>
          <button
            className={toolbarBtn}
            title="Paste"
            onClick={async () => {
              let text = ''
              try {
                text = await navigator.clipboard.readText()
              } catch {
                text = window.prompt('Paste text:') || ''
              }
              if (text) send({ t: 'in', d: text })
              termRef.current?.focus()
            }}
          >
            <Icon name="copy" size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
