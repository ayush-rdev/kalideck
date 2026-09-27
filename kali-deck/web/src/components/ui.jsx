// Shared UI primitives: toasts, cards, pills, toggle, modal, ring, bars.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { cx } from '../lib/api.js'

// ------------------------------------------------------------------ toasts --
const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, kind = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-4), { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed inset-x-0 bottom-[76px] lg:inset-x-auto lg:right-4 lg:bottom-4 z-[60] flex flex-col gap-2 items-center lg:items-end pointer-events-none px-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'fade-in pointer-events-auto max-w-[92vw] lg:max-w-sm rounded-lg border px-3.5 py-2.5 text-[13px] shadow-lg shadow-black/40 backdrop-blur',
              t.kind === 'error'
                ? 'bg-[#2a0f15] border-danger/50 text-danger'
                : t.kind === 'ok'
                  ? 'bg-[#0a1f1a] border-accent/50 text-accent'
                  : 'bg-panel2 border-line2 text-txt'
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

// ------------------------------------------------------------------ basics --
export function Card({ className, children, ...rest }) {
  return (
    <div className={cx('card p-4', className)} {...rest}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, right }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <h2 className="label">{children}</h2>
      {right}
    </div>
  )
}

export function Pill({ kind = 'neutral', children, className }) {
  const styles = {
    neutral: 'border-line2 text-dim',
    ok: 'border-accent/45 text-accent bg-accent/10',
    warn: 'border-warn/45 text-warn bg-warn/10',
    danger: 'border-danger/45 text-danger bg-danger/10',
    info: 'border-accent2/45 text-accent2 bg-accent2/10',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-mono uppercase tracking-wider whitespace-nowrap',
        styles[kind],
        className
      )}
    >
      {children}
    </span>
  )
}

export function StatusDot({ on, className }) {
  return (
    <span
      className={cx(
        'inline-block h-2 w-2 rounded-full shrink-0',
        on ? 'bg-accent shadow-[0_0_6px_var(--color-accent)]' : 'bg-line2',
        className
      )}
    />
  )
}

export function Toggle({ checked, onChange, disabled, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'flex items-center gap-3 text-left w-full group',
        disabled && 'opacity-40 pointer-events-none'
      )}
    >
      <span
        className={cx(
          'relative h-[26px] w-[46px] shrink-0 rounded-full border transition-colors',
          checked
            ? 'bg-accent/25 border-accent/70'
            : 'bg-panel2 border-line2'
        )}
      >
        <span
          className={cx(
            'absolute top-[3px] h-[18px] w-[18px] rounded-full transition-all',
            checked ? 'left-[24px] bg-accent' : 'left-[3px] bg-dim'
          )}
        />
      </span>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-[13px] font-medium">{label}</span>}
          {hint && <span className="block text-[11px] text-dim leading-snug">{hint}</span>}
        </span>
      )}
    </button>
  )
}

export function Spinner({ size = 14, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx('animate-spin', className)}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ------------------------------------------------------------------- ring ---
export function Ring({ pct = 0, size = 84, stroke = 7, color, children }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={
            color ||
            (pct > 85 ? 'var(--color-danger)' : pct > 60 ? 'var(--color-warn)' : 'var(--color-accent)')
          }
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        {children}
      </div>
    </div>
  )
}

export function Meter({ pct = 0, color, className }) {
  return (
    <div className={cx('h-[6px] w-full rounded-full bg-line overflow-hidden', className)}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background:
            color ||
            (pct > 85
              ? 'var(--color-danger)'
              : pct > 60
                ? 'var(--color-warn)'
                : 'var(--color-accent)'),
        }}
      />
    </div>
  )
}

// ------------------------------------------------------------------ modal ---
export function Modal({ open, onClose, title, children, className, wide }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className={cx(
          'fade-in relative w-full flex flex-col bg-panel border border-line2 rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/60 max-h-[92vh]',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-xl',
          className
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-line shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[13px] font-semibold truncate">{title}</span>
          </div>
          <button className="btn !p-1.5" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="overflow-y-auto min-h-0">{children}</div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- copy button --
export function CopyBtn({ text, label = 'Copy', className }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={cx('btn', className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand?.('copy')
          ta.remove()
        }
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={13} />
      {done ? 'Copied' : label}
    </button>
  )
}

// -------------------------------------------------------------- error box ---
export function ErrorBox({ children, onRetry }) {
  if (!children) return null
  return (
    <div className="card border-danger/40 bg-danger/5 p-3 text-[13px] text-danger flex items-start gap-2">
      <Icon name="alert" size={15} className="mt-[2px] shrink-0" />
      <div className="flex-1 break-words">{children}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ icon = 'terminal', title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-2">
      <div className="text-line2 mb-1">
        <Icon name={icon} size={40} />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      {hint && <div className="text-[12.5px] text-dim max-w-sm leading-relaxed">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

// Copy-to-clipboard on a mono block
export function CodeBlock({ children, className }) {
  const ref = useRef(null)
  return (
    <div className={cx('relative group', className)}>
      <pre
        ref={ref}
        className="font-mono text-[12px] leading-relaxed bg-ink border border-line rounded-lg p-3 pr-16 overflow-x-auto whitespace-pre-wrap break-all text-accent2/90"
      >
        {children}
      </pre>
      <button
        className="btn absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(String(children))
          } catch {}
        }}
      >
        <Icon name="copy" size={12} /> Copy
      </button>
    </div>
  )
}
