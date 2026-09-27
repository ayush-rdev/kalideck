// App root: session gate + route switch + global providers.
//
// Pages are lazy-loaded so the first paint only ships the shell: xterm and the
// Docker/Terminals code arrive when you actually open those pages.
import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import { useHashRoute, go } from './lib/hooks.js'
import Login from './pages/Login.jsx'
import Layout from './components/Layout.jsx'
import { ToastProvider } from './components/ui.jsx'
import { TerminalProvider } from './components/TerminalProvider.jsx'
import Icon from './components/Icon.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Tools = lazy(() => import('./pages/Tools.jsx'))
const Terminals = lazy(() => import('./pages/Terminals.jsx'))
const Docker = lazy(() => import('./pages/Docker.jsx'))
const Privacy = lazy(() => import('./pages/Privacy.jsx'))
const Runbooks = lazy(() => import('./pages/Runbooks.jsx'))
const Library = lazy(() => import('./pages/Library.jsx'))

const PAGES = {
  '/dashboard': Dashboard,
  '/tools': Tools,
  '/terminals': Terminals,
  '/docker': Docker,
  '/privacy': Privacy,
  '/runbooks': Runbooks,
  '/library': Library,
}

function Splash() {
  return (
    <div className="h-full grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-dim">
        <span className="grid place-items-center h-11 w-11 rounded-xl border border-accent/50 bg-accent/10 text-accent font-mono font-bold text-xl animate-pulse">
          ◤
        </span>
        <span className="label">loading deck…</span>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState('loading') // loading | ok | none
  const route = useHashRoute()

  const check = async () => {
    try {
      await api('/api/me')
      setSession('ok')
    } catch {
      setSession('none')
    }
  }

  useEffect(() => {
    check()
    const onUnauth = () => setSession('none')
    window.addEventListener('deck:unauthorized', onUnauth)
    return () => window.removeEventListener('deck:unauthorized', onUnauth)
  }, [])

  if (session === 'loading') return <Splash />
  if (session === 'none')
    return (
      <Login
        onOk={() => {
          setSession('ok')
          if (route === '/') go('/dashboard')
        }}
      />
    )

  const Page = PAGES[route] || Dashboard

  return (
    <ToastProvider>
      <TerminalProvider>
        <Layout onLogout={() => setSession('none')}>
          <Suspense
            fallback={
              <div className="h-full grid place-items-center text-dim">
                <Icon name="refresh" size={18} className="animate-pulse" />
              </div>
            }
          >
            <Page />
          </Suspense>
        </Layout>
      </TerminalProvider>
    </ToastProvider>
  )
}
