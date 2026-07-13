import React, { useCallback, useEffect, useState } from 'react'
import type { ArtistRecord, ArtistStatus, ReportFormat } from '@shared/types'
import { api, fmtDuration, unwrap } from '../api'

const STATUSES: Array<ArtistStatus | 'all'> = ['all', 'saved', 'failed', 'skipped', 'pending', 'processing']

/** Searchable, exportable artist database view. */
export function DatabasePanel({ notify }: { notify: (msg: string, err?: boolean) => void }): React.JSX.Element {
  const [rows, setRows] = useState<ArtistRecord[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ArtistStatus | 'all'>('all')

  const load = useCallback(async () => {
    try {
      setRows(await unwrap(api.db.query({ search, status, limit: 500 })))
    } catch (e) {
      notify((e as Error).message, true)
    }
  }, [search, status, notify])

  useEffect(() => {
    load()
    return api.on.artistUpdated(() => load())
  }, [load])

  const remove = async (id: string): Promise<void> => {
    await unwrap(api.db.remove(id))
    load()
  }

  const clear = async (): Promise<void> => {
    if (!confirm('Delete ALL artist records? This cannot be undone.')) return
    try {
      const n = await unwrap(api.db.clear())
      notify(`Cleared ${n} record(s)`)
      load()
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  const exportDb = async (format: ReportFormat): Promise<void> => {
    try {
      const path = await unwrap(api.db.export(format))
      notify(`Exported to ${path}`)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <input placeholder="Search name or URL…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value as ArtistStatus | 'all')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button className="btn" onClick={load}>
              Search
            </button>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => exportDb('csv')}>
              Export CSV
            </button>
            <button className="btn" onClick={() => exportDb('json')}>
              Export JSON
            </button>
            <button className="btn" onClick={() => exportDb('xlsx')}>
              Export Excel
            </button>
            <button className="btn danger" onClick={clear}>
              Clear Database
            </button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Updates</th>
              <th>Retries</th>
              <th>Duration</th>
              <th>Processed</th>
              <th>Reason</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.artistId}>
                <td>
                  <a href={r.profileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    {r.name}
                  </a>
                </td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                <td>{r.updatesEnabled ? '✓' : '—'}</td>
                <td>{r.retryCount}</td>
                <td>{fmtDuration(r.durationMs)}</td>
                <td className="muted">{r.processedAt ? new Date(r.processedAt).toLocaleString() : '—'}</td>
                <td className="muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.failureReason ?? '—'}
                </td>
                <td>
                  <button className="btn danger" onClick={() => remove(r.artistId)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
