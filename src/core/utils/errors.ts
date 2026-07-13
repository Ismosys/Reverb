/**
 * Typed error hierarchy. Using discrete classes lets callers decide recovery
 * strategy (retry vs. abort vs. surface-to-user) without brittle string checks.
 */

export class AppError extends Error {
  /** Whether the operation may succeed if retried. */
  readonly recoverable: boolean
  /** Stable machine-readable code. */
  readonly code: string

  constructor(message: string, opts: { code?: string; recoverable?: boolean; cause?: unknown } = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = opts.code ?? 'APP_ERROR'
    this.recoverable = opts.recoverable ?? false
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause
  }
}

/** The browser session is not authenticated (or expired). */
export class AuthenticationError extends AppError {
  constructor(message = 'Not authenticated', cause?: unknown) {
    super(message, { code: 'AUTH', recoverable: false, cause })
  }
}

/** A transient automation failure that is safe to retry. */
export class RecoverableError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'RECOVERABLE', recoverable: true, cause })
  }
}

/** The browser/page became unusable and must be re-created. */
export class BrowserCrashError extends AppError {
  constructor(message = 'Browser crashed', cause?: unknown) {
    super(message, { code: 'BROWSER_CRASH', recoverable: true, cause })
  }
}

/** Configuration failed validation. */
export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'CONFIG', recoverable: false, cause })
  }
}

/** Normalise any thrown value into a readable string. */
export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
