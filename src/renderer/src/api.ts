import type { IpcResult } from '@shared/types'

/** Thin wrapper around window.reverb — unwraps IpcResult envelopes. */
export const api = window.reverb

/** Unwrap an IpcResult, throwing on failure so callers can try/catch. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error ?? 'Unknown error')
  return res.data as T
}

/** Format milliseconds as m:ss / h:mm:ss. */
export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
