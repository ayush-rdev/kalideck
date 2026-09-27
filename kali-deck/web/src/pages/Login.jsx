// Password login gate.
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import Icon from '../components/Icon.jsx'
import { Spinner } from '../components/ui.jsx'

export default function Login({ onOk }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shake, setShake] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (e) => {
    e?.preventDefault()
    if (busy || !pw) return
    setBusy(true)
    setErr('')
    try {
      await api('/api/login', { method: 'POST', body: { password: pw } })
      onOk?.()
    } catch (ex) {
      setErr(
        ex.status === 401
          ? 'wrong password'
          : ex.status === 429
            ? 'too many attempts - wait a moment'
            : ex.message
      )
      setShake(true)
      setTimeout(() => setShake(false), 400)
      setPw('')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-5 relative overflow-hidden">
      {/* faint grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 50% 40%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 40%, black 0%, transparent 75%)',
        }}
      />
      <form
        onSubmit={submit}
        className={`relative w-full max-w-[360px] card p-6 ${shake ? 'animate-pulse' : ''}`}
      >
        <div className="flex flex-col items-center gap-2 mb-6">
          <span className="grid place-items-center h-12 w-12 rounded-xl border border-accent/50 bg-accent/10 text-accent font-mono font-bold text-2xl">
            ◤
          </span>
          <div className="font-mono font-bold tracking-[0.22em] text-[15px]">
            KALI<span className="text-accent">DECK</span>
          </div>
          <div className="label">lab console · authorized use only</div>
        </div>

        <label className="label block mb-1.5" htmlFor="pw">
          password
        </label>
        <div className="relative">
          <input
            id="pw"
            ref={inputRef}
            className="input pr-10 font-mono tracking-widest"
            type={show ? 'text' : 'password'}
            value={pw}
            autoComplete="current-password"
            placeholder="••••••••"
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            type="button"
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-txt p-1"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'hide password' : 'show password'}
          >
            <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
          </button>
        </div>

        {err && (
          <div className="mt-3 text-[12.5px] text-danger flex items-center gap-1.5">
            <Icon name="alert" size={13} /> {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !pw}
          className="btn btn-primary w-full !min-h-[42px] mt-4 text-[13.5px]"
        >
          {busy ? <Spinner size={14} /> : <Icon name="lock" size={14} />}
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <div className="mt-5 text-[11px] text-dim leading-relaxed text-center">
          password lives in <span className="font-mono text-accent2">kali-deck/.env</span>
          <br />
          (DECK_PASSWORD)
        </div>
      </form>
    </div>
  )
}
