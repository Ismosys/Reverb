import React from 'react'
import type { HealthSnapshot, RunStatus } from '@shared/types'
import { fmtDuration } from '../api'
import { Dot, ProgressBar, Stat } from './common'

const ENGINE_LABEL: Record<string, string> = {
  idle: 'Idle',
  starting: 'Starting',
  authenticating: 'Authenticating',
  navigating: 'Navigating',
  scanning: 'Scanning',
  processing: 'Processing',
  paused: 'Paused',
  stopping: 'Stopping',
  completed: 'Completed',
  error: 'Error'
}

function authTone(status?: string): 'ok' | 'err' | 'warn' {
  if (status === 'authenticated') return 'ok'
  if (status === 'expired' || status === 'unauthenticated') return 'err'
  return 'warn'
}

export function Dashboard({
  status,
  health
}: {
  status: RunStatus | null
  health: HealthSnapshot | null
}): React.JSX.Element {
  const s = status
  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* Progress card */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {ENGINE_LABEL[s?.engineState ?? 'idle'] ?? 'Idle'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
              {s?.currentOperation ?? 'Ready to start'}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              {s?.currentArtist ? `Current artist: ${s.currentArtist}` : 'No artist in progress'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{Math.round((s?.progress ?? 0) * 100)}%</div>
            <div className="muted">
              Elapsed {fmtDuration(s?.elapsedMs)} · ETA {fmtDuration(s?.etaMs)}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <ProgressBar value={s?.progress ?? 0} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid stats">
        <Stat label="Account" value={s?.authStatus ?? 'unknown'} tone={authTone(s?.authStatus)} />
        <Stat label="Location" value={s?.activeLocationLabel ?? '—'} />
        <Stat label="Processed" value={s?.processed ?? 0} />
        <Stat label="Remaining" value={s?.remaining ?? 0} />
        <Stat label="Saved" value={s?.saved ?? 0} tone="ok" />
        <Stat label="Skipped" value={s?.skipped ?? 0} tone="warn" />
        <Stat label="Failed" value={s?.failed ?? 0} tone={s && s.failed > 0 ? 'err' : undefined} />
        <Stat label="Speed / min" value={s?.speedPerMin ?? 0} />
        <Stat label="Browser" value={s?.browserStatus ?? 'closed'} />
        <Stat label="ETA" value={fmtDuration(s?.etaMs)} />
      </div>

      {/* Health */}
      <div className="card">
        <div className="section-title" style={{ margin: '0 0 12px' }}>
          System Health
        </div>
        <div className="row" style={{ gap: 22 }}>
          <HealthItem label="Browser" ok={health?.browser === 'ready'} text={health?.browser ?? '—'} />
          <HealthItem label="Database" ok={health?.database === 'ok'} text={health?.database ?? '—'} />
          <HealthItem
            label="Network"
            ok={health?.network === 'online'}
            text={health?.network ?? '—'}
          />
          <HealthItem label="Automation" ok text={health?.automation ?? 'idle'} />
          <div className="row" style={{ gap: 8 }}>
            <span className="muted">Memory</span>
            <strong>{health ? `${health.memoryMb} MB` : '—'}</strong>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted">CPU</span>
            <strong>{health ? `${health.cpuPercent}%` : '—'}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

function HealthItem({ label, ok, text }: { label: string; ok: boolean; text: string }): React.JSX.Element {
  return (
    <div className="row" style={{ gap: 8 }}>
      <Dot state={ok ? 'ok' : 'warn'} />
      <span className="muted">{label}</span>
      <strong>{text}</strong>
    </div>
  )
}
