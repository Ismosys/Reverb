import React, { useCallback, useEffect, useState } from 'react'
import { api, unwrap } from './api'
import { useConfig, useEngineStatus, useHealth, useLogs } from './hooks'
import { Dashboard } from './components/Dashboard'
import { LocationsPanel } from './components/LocationsPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { DatabasePanel } from './components/DatabasePanel'
import { LogsPanel } from './components/LogsPanel'
import { Dot } from './components/common'

type Tab = 'dashboard' | 'locations' | 'settings' | 'database' | 'logs'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'locations', label: 'Locations' },
  { id: 'settings', label: 'Settings' },
  { id: 'database', label: 'Database' },
  { id: 'logs', label: 'Logs' }
]

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const status = useEngineStatus()
  const health = useHealth()
  const logs = useLogs()
  const { config, setConfig } = useConfig()

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // Auto-dismiss toast timer cleanup handled by setTimeout above.
  useEffect(() => () => setToast(null), [])

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await fn()
      } catch (e) {
        notify(`${label}: ${(e as Error).message}`, true)
      } finally {
        setBusy(false)
      }
    },
    [notify]
  )

  const engineState = status?.engineState ?? 'idle'
  const running = ['starting', 'authenticating', 'navigating', 'scanning', 'processing'].includes(engineState)
  const paused = engineState === 'paused'

  const login = () =>
    run('Login', async () => {
      const s = await unwrap(api.auth.login())
      notify(`Authentication: ${s}`)
    })
  const start = () =>
    run('Start', async () => {
      await unwrap(api.engine.start())
    })
  const test = () =>
    run('Test Connection', async () => {
      const r = await unwrap(api.engine.testConnection())
      notify(r.online ? `Online (HTTP ${r.status})` : `Offline (HTTP ${r.status})`, !r.online)
    })

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" />
          Reverb
        </div>
        {TABS.map((t) => (
          <div key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </div>
        ))}
        <div className="spacer" />
        <div className="status-pill">
          <Dot state={status?.authStatus === 'authenticated' ? 'ok' : 'warn'} />
          {status?.authStatus ?? 'unknown'}
        </div>
        <div className="status-pill">
          <Dot state={status?.browserStatus === 'ready' ? 'ok' : 'idle'} />
          browser {status?.browserStatus ?? 'closed'}
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
            <div className="sub">
              {running ? `Running — ${status?.currentOperation ?? ''}` : paused ? 'Paused' : 'Idle'}
            </div>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={login} disabled={busy || running}>
              Login
            </button>
            <button className="btn" onClick={test} disabled={busy}>
              Test Connection
            </button>
            {!running && !paused && (
              <button className="btn primary" onClick={start} disabled={busy}>
                Start Automation
              </button>
            )}
            {running && (
              <button className="btn" onClick={() => run('Pause', () => unwrap(api.engine.pause()))}>
                Pause
              </button>
            )}
            {paused && (
              <button className="btn primary" onClick={() => run('Resume', () => unwrap(api.engine.resume()))}>
                Resume
              </button>
            )}
            {(running || paused) && (
              <button className="btn danger" onClick={() => run('Stop', () => unwrap(api.engine.stop()))}>
                Stop
              </button>
            )}
            <button className="btn" onClick={() => run('Export', () => unwrap(api.report.export('csv')).then((p) => notify(`Report: ${p}`)))} disabled={busy}>
              Export Results
            </button>
          </div>
        </div>

        {tab === 'dashboard' && <Dashboard status={status} health={health} />}
        {tab === 'locations' && config && <LocationsPanel config={config} onChange={setConfig} notify={notify} />}
        {tab === 'settings' && config && <SettingsPanel config={config} onChange={setConfig} notify={notify} />}
        {tab === 'database' && <DatabasePanel notify={notify} />}
        {tab === 'logs' && <LogsPanel logs={logs} notify={notify} />}
      </main>

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
