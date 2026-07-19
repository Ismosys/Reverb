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

const AVATAR_COLORS = ['#5b8cff', '#7c5bff', '#3ecf8e', '#f5a623', '#ff5c67', '#22c1c3', '#e857b6', '#8a7bff']

/** Deterministic initials avatar coloured by the account id/name. */
export function Avatar({ name, size = 38 }: { name: string; size?: number }): React.JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${color}, ${color}bb)`,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0
      }}
    >
      {initials || '?'}
    </div>
  )
}
