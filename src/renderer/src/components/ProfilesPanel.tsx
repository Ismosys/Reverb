import React, { useEffect, useState } from 'react'
import type { ProfileInfo, RunStatus } from '@shared/types'
import { api, fmtAgo, unwrap } from '../api'
import { Avatar } from './common'

/** Live status label + badge class for an account. */
function accountStatus(p: ProfileInfo, status: RunStatus | null): { label: string; cls: string } {
  const rot = status?.rotation
  const running = ['starting', 'authenticating', 'navigating', 'scanning', 'processing'].includes(
    status?.engineState ?? ''
  )
  if (running && rot?.activeProfileId === p.id) return { label: 'Running', cls: 'saved' }
  if (!p.hasSession) return { label: 'Not signed in', cls: 'failed' }
  if (p.active) return { label: 'Active', cls: 'saved' }
  return { label: 'Ready', cls: 'skipped' }
}

/**
 * Multi-account switcher (Telegram-style). Each account is a fully isolated
 * ReverbNation session; the shared database tracks how many artists each has
 * saved and when it was last active. Add accounts, switch, rename, or remove.
 */
export function ProfilesPanel({
  profiles,
  reload,
  onSwitched,
  status,
  notify
}: {
  profiles: ProfileInfo[]
  reload: () => Promise<void>
  onSwitched: () => void
  status: RunStatus | null
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
  // Refresh counts/last-activity while a run is in progress.
  useEffect(() => {
    const t = setInterval(() => reload().catch(() => undefined), 4000)
    return () => clearInterval(t)
  }, [reload])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      await reload()
      notify(msg)
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      await unwrap(api.profiles.add(newName.trim() || `Account ${profiles.length + 1}`))
      setNewName('')
    }, 'Account added')

  const switchTo = (p: ProfileInfo) =>
    run(async () => {
      await unwrap(api.profiles.setActive(p.id))
      onSwitched()
    }, `Switched to ${p.name}`)

  const remove = (p: ProfileInfo) => {
    if (!confirm(`Remove "${p.name}"? Its saved session and history will be deleted.`)) return
    run(async () => {
      await unwrap(api.profiles.remove(p.id))
      onSwitched()
    }, `Removed ${p.name}`)
  }

  const saveRename = (p: ProfileInfo) =>
    run(async () => {
      await unwrap(api.profiles.rename(p.id, editName.trim() || p.name))
      setEditingId(null)
    }, 'Renamed')

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card">
        <div className="muted">
          Each account has its own <strong>logged-in browser session</strong> and its own saved-artist history —
          just like multiple accounts in Telegram. Switch anytime; the automation always runs on the active account.
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Accounts
        </div>
        <div className="grid" style={{ gap: 10 }}>
          {profiles.map((p) => (
            <div
              key={p.id}
              className="row"
              style={{
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: p.active ? 'var(--bg-elev-2)' : 'transparent'
              }}
            >
              <div className="row" style={{ gap: 12 }}>
                <Avatar name={p.name} />
                <div>
                  {editingId === p.id ? (
                    <input
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRename(p)}
                      onBlur={() => saveRename(p)}
                      style={{ minWidth: 200 }}
                    />
                  ) : (
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {p.name}
                      {(() => {
                        const st = accountStatus(p, status)
                        return <span className={`badge ${st.cls}`}>{st.label}</span>
                      })()}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {p.hasSession ? 'Signed in' : 'Not signed in yet'} · {p.savedCount} saved · active {fmtAgo(p.lastActivity)}
                  </div>
                </div>
              </div>
              <div className="btn-row">
                {!p.active && (
                  <button className="btn primary" disabled={busy} onClick={() => switchTo(p)}>
                    Switch
                  </button>
                )}
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setEditingId(p.id)
                    setEditName(p.name)
                  }}
                >
                  Rename
                </button>
                {profiles.length > 1 && (
                  <button className="btn danger" disabled={busy} onClick={() => remove(p)}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          Add Account
        </div>
        <div className="row">
          <input
            placeholder="Account name (e.g. My Band, Label…)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            style={{ minWidth: 280 }}
          />
          <button className="btn primary" disabled={busy} onClick={add}>
            Add Account
          </button>
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          After adding, click <strong>Switch</strong> to it, then <strong>Login</strong> (top bar) to sign into that
          ReverbNation account.
        </div>
      </div>
    </div>
  )
}
