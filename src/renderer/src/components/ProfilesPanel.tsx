import React, { useState } from 'react'
import type { ProfileInfo } from '@shared/types'
import { api, unwrap } from '../api'
import { Dot } from './common'

/**
 * Multi-account switcher (Telegram-style). Each account is a fully isolated
 * ReverbNation session with its own saved-artist history. Add accounts, switch
 * the active one, rename, or remove.
 */
export function ProfilesPanel({
  profiles,
  reload,
  onSwitched,
  notify
}: {
  profiles: ProfileInfo[]
  reload: () => Promise<void>
  onSwitched: () => void
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
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
                <Dot state={p.hasSession ? 'ok' : 'warn'} />
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
                    <div style={{ fontWeight: 700 }}>
                      {p.name}
                      {p.active && (
                        <span className="badge saved" style={{ marginLeft: 8 }}>
                          Active
                        </span>
                      )}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.hasSession ? 'Signed in · session saved' : 'Not signed in yet'}
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
