// Privacy: public IP checks, Tor daemon control, ProtonVPN, DNS and the
// global "route runs through Tor" toggle.
import { useState } from 'react'
import { api, cx } from '../lib/api.js'
import { usePoll } from '../lib/hooks.js'
import Icon from '../components/Icon.jsx'
import {
  Card,
  Pill,
  Spinner,
  ErrorBox,
  Toggle,
  useToast,
  SectionTitle,
} from '../components/ui.jsx'
import { useTerminals } from '../components/TerminalProvider.jsx'

export default function Privacy() {
  const [p, setP] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [vpnCountry, setVpnCountry] = useState('')
  const toast = useToast()
  const { openTerminal } = useTerminals()

  const load = async (refresh = false) => {
    try {
      setP(await api(`/api/privacy${refresh ? '?refresh=1&tor=1' : ''}`))
      setErr('')
    } catch (e) {
      if (e.status !== 401) setErr(e.message)
    }
  }

  usePoll(() => load(false), 25000)

  const act = async (action, params = {}, successMsg) => {
    setBusy(action)
    try {
      const r = await api('/api/privacy/action', { method: 'POST', body: { action, ...params } })
      if (r.ok === false) toast(r.error || 'action failed', 'error')
      else if (successMsg) toast(successMsg, 'ok')
      await load(action === 'ip_check' || action === 'tor_ip_check')
      return r
    } catch (e) {
      toast(e.message, 'error')
      return { ok: false, error: e.message }
    } finally {
      setBusy('')
    }
  }

  if (!p && !err)
    return (
      <div className="h-full grid place-items-center text-dim">
        <Spinner size={22} />
      </div>
    )

  const ip = p?.ip?.direct || {}
  const torIp = p?.ip?.tor || null
  const vpn = p?.vpn || {}
  const wg = p?.wireguard || {}
  const tor = p?.tor || {}

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 sm:p-4 lg:p-5 max-w-[1200px] mx-auto space-y-4 pb-10">
        {err && <ErrorBox onRetry={() => load()}>{err}</ErrorBox>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* ----------------------------------------------------- public IP */}
          <Card className="lg:col-span-2">
            <SectionTitle
              right={
                <button
                  className="btn !py-1"
                  disabled={busy !== ''}
                  onClick={() => load(true)}
                >
                  <Icon name="refresh" size={12} /> Re-check
                </button>
              }
            >
              public ip
            </SectionTitle>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <div className="font-mono text-[26px] sm:text-[32px] font-bold leading-none tracking-tight">
                  {ip.error ? <span className="text-danger text-[15px]">{ip.error}</span> : ip.ip || '…'}
                </div>
                <div className="text-[12px] text-dim mt-1.5">
                  {[ip.city, ip.region, ip.country].filter(Boolean).join(', ') || 'location n/a'}
                  {ip.org && <span className="text-dim/80"> · {ip.org}</span>}
                </div>
              </div>
              <Pill kind="info">direct</Pill>
            </div>

            <div className="mt-4 pt-3 border-t border-line flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="label mb-1">via tor</div>
                <div className="font-mono text-[16px] truncate">
                  {tor.socksUp ? (
                    torIp ? (
                      torIp.error ? (
                        <span className="text-danger text-[12.5px]">{torIp.error}</span>
                      ) : (
                        <span className="text-accent">{torIp.ip}</span>
                      )
                    ) : (
                      <span className="text-dim text-[12.5px]">not checked yet</span>
                    )
                  ) : (
                    <span className="text-dim text-[12.5px]">tor is off</span>
                  )}
                </div>
              </div>
              <button
                className="btn"
                disabled={!tor.socksUp || busy !== ''}
                onClick={() => act('tor_ip_check', {}, null)}
              >
                {busy === 'tor_ip_check' ? <Spinner size={12} /> : <Icon name="globe" size={13} />}
                Check via Tor
              </button>
            </div>
          </Card>

          {/* ---------------------------------------------------------- tor */}
          <Card>
            <SectionTitle>tor daemon</SectionTitle>
            <div className="flex items-center gap-3 mb-3">
              <span
                className={cx(
                  'h-2.5 w-2.5 rounded-full',
                  tor.socksUp
                    ? 'bg-accent shadow-[0_0_8px_var(--color-accent)]'
                    : 'bg-line2'
                )}
              />
              <span className="font-mono text-[15px] font-semibold">
                {tor.socksUp ? 'running' : 'stopped'}
              </span>
              <Pill className="ml-auto">127.0.0.1:{tor.socksPort || 9050}</Pill>
            </div>
            <p className="text-[11.5px] text-dim leading-relaxed mb-3">
              Tor runs <em>inside kali-lab</em> (host networking, so port {tor.socksPort || 9050}{' '}
              is reachable host-wide). Start it to enable SOCKS routing and Tor IP checks.
            </p>
            <div className="flex gap-2">
              {!tor.socksUp ? (
                <button
                  className="btn btn-primary flex-1"
                  disabled={busy !== ''}
                  onClick={() => act('tor_start', {}, 'tor started')}
                >
                  {busy === 'tor_start' ? <Spinner size={13} /> : <Icon name="play" size={13} />}
                  Start Tor
                </button>
              ) : (
                <button
                  className="btn btn-danger flex-1"
                  disabled={busy !== ''}
                  onClick={() => act('tor_stop', {}, 'tor stopped')}
                >
                  {busy === 'tor_stop' ? <Spinner size={13} /> : <Icon name="stop" size={13} />}
                  Stop Tor
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Pill kind={p?.tools?.tor ? 'ok' : 'danger'}>
                tor {p?.tools?.tor ? 'installed' : 'missing'}
              </Pill>
              <Pill kind={p?.tools?.proxychains ? 'ok' : 'danger'}>
                proxychains4 {p?.tools?.proxychains ? 'ok' : 'missing'}
              </Pill>
            </div>
          </Card>
        </div>

        {/* -------------------------------------------------- tor route toggle */}
        <Card>
          <SectionTitle
            right={
              <Pill kind={p?.torRoute ? 'ok' : 'neutral'}>
                {p?.torRoute ? 'routing on' : 'routing off'}
              </Pill>
            }
          >
            proxy routing
          </SectionTitle>
          <Toggle
            checked={!!p?.torRoute}
            onChange={(v) =>
              act(v ? 'route_on' : 'route_off', {}, v ? 'runs will use proxychains' : 'direct runs')
            }
            label="Route quick runs through Tor"
            hint="Prefixes commands from Runbooks & quick runs with `proxychains4 -q` so their traffic exits through the Tor daemon. Terminals stay direct - you control them."
          />
          <div className="mt-3 font-mono text-[11.5px] bg-ink border border-line rounded-lg px-3 py-2 text-dim break-all">
            <span className="text-accent">$ </span>
            {p?.torRoute ? (
              <>
                <span className="text-warn">proxychains4 -q</span> nuclei -u https://target
              </>
            ) : (
              <>nuclei -u https://target</>
            )}
            <span className="text-dim/60">  ← preview</span>
          </div>
          {p?.torRoute && !tor.socksUp && (
            <div className="mt-2.5 text-[12px] text-warn flex items-start gap-1.5">
              <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
              Tor is stopped - routed commands will fail until you start it.
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------------- vpn */}
        <Card>
          <SectionTitle
            right={
              <Pill kind={!vpn.available ? 'neutral' : vpn.connected ? 'ok' : vpn.initialized ? 'warn' : 'warn'}>
                {!vpn.available
                  ? 'not installed'
                  : vpn.connected
                    ? 'connected'
                    : vpn.initialized
                      ? 'disconnected'
                      : 'not initialized'}
              </Pill>
            }
          >
            protonvpn
          </SectionTitle>

          {vpn.connected ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
              <div>
                <div className="label mb-1">server</div>
                <div className="font-mono text-[15px]">{vpn.server || '-'}</div>
              </div>
              {vpn.ip && (
                <div>
                  <div className="label mb-1">exit ip</div>
                  <div className="font-mono text-[15px] text-accent">{vpn.ip}</div>
                </div>
              )}
              {vpn.protocol && (
                <div>
                  <div className="label mb-1">protocol</div>
                  <div className="font-mono text-[15px]">{vpn.protocol}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-dim mb-3">
              {vpn.available
                ? vpn.initialized
                  ? 'Not connected. Connect below or from a terminal - the CLI stays the source of truth.'
                  : 'No profile initialized yet - run `protonvpn init` once (needs your Proton credentials).'
                : 'protonvpn CLI not found on the host.'}
            </p>
          )}

          {!vpn.initialized ? (
            <button
              className="btn btn-primary"
              onClick={() =>
                openTerminal({ title: 'protonvpn init', preset: 'cmd', cmd: 'protonvpn init' })
              }
            >
              <Icon name="terminal" size={13} /> Open `protonvpn init`
            </button>
          ) : vpn.connected ? (
            <button
              className="btn btn-danger"
              disabled={busy !== ''}
              onClick={() => act('vpn_disconnect', {}, 'disconnect sent')}
            >
              {busy === 'vpn_disconnect' ? <Spinner size={13} /> : <Icon name="power" size={13} />}
              Disconnect
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={busy !== ''}
                onClick={() => act('vpn_connect', { mode: 'fastest' }, 'connect sent')}
              >
                {busy === 'vpn_connect' ? <Spinner size={13} /> : <Icon name="play" size={13} />}
                Fastest
              </button>
              <button
                className="btn"
                disabled={busy !== ''}
                onClick={() => act('vpn_connect', { mode: 'random' }, 'connect sent')}
              >
                Random
              </button>
              <div className="flex items-center gap-1.5">
                <input
                  className="input !w-16 text-center font-mono uppercase"
                  placeholder="US"
                  maxLength={2}
                  value={vpnCountry}
                  onChange={(e) => setVpnCountry(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={busy !== '' || vpnCountry.length !== 2}
                  onClick={() =>
                    act('vpn_connect', { mode: 'country', cc: vpnCountry }, 'connect sent')
                  }
                >
                  Country
                </button>
              </div>
              <button
                className="btn"
                onClick={() =>
                  openTerminal({ title: 'protonvpn', preset: 'cmd', cmd: 'protonvpn connect' })
                }
              >
                <Icon name="terminal" size={13} /> Interactive
              </button>
            </div>
          )}

          {vpn.available && !vpn.initialized && (
            <div className="mt-3 text-[11.5px] text-dim leading-relaxed">
              CLI found at <span className="font-mono text-accent2">/usr/local/bin/protonvpn</span>.
              Non-interactive connect may require the sudoers rule from{' '}
              <span className="font-mono text-accent2">kali-deck/setup-sudo.sh</span> - otherwise
              use the interactive terminal button.
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------- wireguard */}
        <Card>
          <SectionTitle
            right={
              <Pill kind={wg.active ? 'ok' : 'neutral'}>
                {wg.active ? 'tunnel up' : 'tunnel down'}
              </Pill>
            }
          >
            wireguard vpn
          </SectionTitle>

          {wg.interfaces?.length ? (
            <div className="space-y-2 mb-3">
              {wg.interfaces.map((i) => (
                <div
                  key={i.name}
                  className="flex items-center gap-3 bg-ink border border-line rounded-lg px-3 py-2"
                >
                  <span
                    className={cx(
                      'h-2.5 w-2.5 rounded-full shrink-0',
                      i.up ? 'bg-accent shadow-[0_0_8px_var(--color-accent)]' : 'bg-line2'
                    )}
                  />
                  <span className="font-mono text-[13.5px] min-w-0 truncate">{i.name}</span>
                  <Pill kind={i.up ? 'ok' : 'neutral'} className="ml-auto shrink-0">
                    {i.up ? 'up' : 'down'}
                  </Pill>
                  <button
                    className={cx('btn !py-1 shrink-0', i.up && 'btn-danger')}
                    disabled={busy !== ''}
                    onClick={() =>
                      act(
                        i.up ? 'wg_down' : 'wg_up',
                        { name: i.name },
                        i.up ? 'tunnel down' : 'tunnel up'
                      )
                    }
                  >
                    {busy === (i.up ? 'wg_down' : 'wg_up') ? (
                      <Spinner size={11} />
                    ) : (
                      <Icon name={i.up ? 'stop' : 'play'} size={11} />
                    )}
                    {i.up ? 'Down' : 'Up'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-dim mb-3 leading-relaxed">
              No WireGuard interface found. ProtonVPN&apos;s official Linux app and{' '}
              <span className="font-mono text-accent2">wg-quick</span> both create{' '}
              <span className="font-mono text-accent2">wg-*</span> interfaces - bring one up and it
              appears here.
            </p>
          )}

          <div className="text-[11.5px] text-dim leading-relaxed">
            Toggling needs the sudoers rule from{' '}
            <span className="font-mono text-accent2">kali-deck/setup-sudo.sh</span> (limited to{' '}
            <span className="font-mono text-accent2">wg-*</span> interfaces). Only names and up-state
            are read - WireGuard keys never leave the kernel.
          </div>
        </Card>

        {/* ------------------------------------------------------------ dns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <SectionTitle>dns</SectionTitle>
            <div className="space-y-1.5">
              {(p?.dns || []).map((d) => (
                <div
                  key={d}
                  className="font-mono text-[13px] flex items-center gap-2 bg-ink border border-line rounded-lg px-3 py-2"
                >
                  <Icon name="globe" size={13} className="text-accent2" />
                  {d}
                </div>
              ))}
              {p?.dns?.length === 0 && <div className="text-dim text-[12.5px]">no resolvers found</div>}
            </div>
            <div className="text-[11px] text-dim mt-2.5 leading-relaxed">
              System resolvers as seen by the deck host. When Tor routing is on, lookups go through
              Tor instead (DNS leak resistant by construction).
            </div>
          </Card>

          <Card>
            <SectionTitle>posture</SectionTitle>
            <ul className="space-y-2 text-[12.5px] text-dim leading-relaxed">
              <li className="flex gap-2">
                <Icon name="check" size={14} className="text-accent mt-0.5 shrink-0" />
                Deck login is password-gated with sessions (SameSite=Strict cookies).
              </li>
              <li className="flex gap-2">
                <Icon name="check" size={14} className="text-accent mt-0.5 shrink-0" />
                Tools run inside <span className="font-mono text-accent2">kali-lab</span> - no host
                root, no docker socket in the container.
              </li>
              <li className="flex gap-2">
                <Icon name="alert" size={14} className="text-warn mt-0.5 shrink-0" />
                Traffic is plain HTTP on your lab port - keep it on Tailscale/VPN/Tor networks, or
                put TLS in front.
              </li>
              <li className="flex gap-2">
                <Icon name="alert" size={14} className="text-warn mt-0.5 shrink-0" />
                Only run scans against targets you own or are authorized to test.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
