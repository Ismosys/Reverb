import React from 'react'

export function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: React.ReactNode
  tone?: 'ok' | 'err' | 'warn'
}): React.JSX.Element {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

export function ProgressBar({ value }: { value: number }): React.JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Dot({ state }: { state: 'ok' | 'warn' | 'err' | 'idle' }): React.JSX.Element {
  const cls = state === 'idle' ? '' : state
  return <span className={`dot ${cls}`} />
}
