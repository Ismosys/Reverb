import { AppError } from './errors'

/**
 * Small guard helpers for defensive input validation at module boundaries.
 * These throw AppError so failures are uniform and machine-inspectable.
 */

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError(message, { code: 'VALIDATION' })
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function requireString(v: unknown, field: string): string {
  assert(isNonEmptyString(v), `Expected non-empty string for "${field}"`)
  return (v as string).trim()
}

export function requireNumber(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === 'string' ? Number(v) : v
  assert(typeof n === 'number' && Number.isFinite(n), `Expected finite number for "${field}"`)
  if (opts.min !== undefined) assert((n as number) >= opts.min, `"${field}" must be >= ${opts.min}`)
  if (opts.max !== undefined) assert((n as number) <= opts.max, `"${field}" must be <= ${opts.max}`)
  return n as number
}

/** Clamp a number into an inclusive range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Derive a stable artist id from a ReverbNation profile URL. Falls back to a
 * slug of the full path so ids remain deterministic even for odd URL shapes.
 */
export function artistIdFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const byId = u.pathname.match(/\/artist\/(?:[^/]+\/)?(\d+)/) ?? u.search.match(/artist_id=(\d+)/)
    if (byId) return byId[1]
    const slug = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    return slug || u.host
  } catch {
    return url.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80)
  }
}

/** Validate that a string is a plausible http(s) URL. */
export function isHttpUrl(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
