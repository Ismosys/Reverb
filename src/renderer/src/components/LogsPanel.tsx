import React, { useEffect, useRef } from 'react'
import type { LogEntry } from '@shared/types'
import { api, unwrap } from '../api'

/** Real-time, auto-scrolling log console with export. */
export function LogsPanel({
  logs,
  notify
}: {
  logs: LogEntry[]
  notify: (msg: string, err?: boolean) => void
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const exportLogs = async (): Promise<void> => {
    try {
      const path = await unwrap(api.logs.export())
      notify(path ? `Logs exported to ${path}` : 'Export cancelled')
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{logs.length} entries (live)</span>
        <button className="btn" onClick={exportLogs}>
          Export Logs
        </button>
      </div>
      <div className="logs">
        {logs.map((l) => (
          <div className="log-line" key={l.id}>
            <span className="ts">{new Date(l.timestamp).toLocaleTimeString()}</span>
            <span className={`lvl ${l.level}`}>{l.level.toUpperCase()}</span>
            <span className="muted">[{l.action}]</span>
            <span className="msg">
              {l.message}
              {l.artist ? ` · ${l.artist}` : ''}
              {l.retryCount ? ` · retry ${l.retryCount}` : ''}
              {l.durationMs ? ` · ${l.durationMs}ms` : ''}
              {l.error ? ` · ${l.error}` : ''}
            </span>
          </div>
        ))}
        {logs.length === 0 && <div className="muted">Waiting for activity…</div>}
        <div ref={endRef} />
      </div>
    </div>
  )
}
