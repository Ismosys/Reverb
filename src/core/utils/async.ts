import { AppError, toMessage } from './errors'

/** Deterministic pseudo-random in [0,1) — avoids Math.random for testability. */
let seed = 0x2f6e2b1
function rng(): number {
  // xorshift32
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 1_000_000) / 1_000_000
}

/** A promise that resolves after `ms`, rejecting early if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('Aborted', { code: 'ABORTED' }))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AppError('Aborted', { code: 'ABORTED' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Random integer in [min, max] inclusive. */
export function randomInt(min: number, max: number): number {
  if (max <= min) return Math.max(0, Math.floor(min))
  return Math.floor(min + rng() * (max - min + 1))
}

/** Sleep for a random duration within the given range (human-like pacing). */
export function jitter(range: { min: number; max: number }, signal?: AbortSignal): Promise<void> {
  return sleep(randomInt(range.min, range.max), signal)
}

export interface RetryOptions {
  retries: number
  /** Base backoff in ms; grows exponentially with attempt. */
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Called before each retry. */
  onRetry?: (attempt: number, error: unknown) => void
  /** Return false to stop retrying a particular error. */
  shouldRetry?: (error: unknown) => boolean
}

/**
 * Run `fn`, retrying on failure with exponential backoff + jitter.
 * Aborts immediately if the signal fires or `shouldRetry` returns false.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { retries, baseDelayMs = 500, maxDelayMs = 8000, signal, onRetry, shouldRetry } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new AppError('Aborted', { code: 'ABORTED' })
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      const retryable = shouldRetry ? shouldRetry(err) : true
      if (!retryable || attempt === retries) break
      onRetry?.(attempt + 1, err)
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      await sleep(backoff + randomInt(0, 250), signal)
    }
  }
  throw new AppError(`Operation failed after ${retries + 1} attempt(s): ${toMessage(lastError)}`, {
    code: 'RETRY_EXHAUSTED',
    recoverable: false,
    cause: lastError
  })
}

/** Reject if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  if (ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError(`${label} timed out after ${ms}ms`, { code: 'TIMEOUT' })), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Run tasks with bounded concurrency, preserving input order in the results.
 * A rejected task does not cancel the pool; its slot resolves to the rejection
 * which the caller can inspect via Promise.allSettled semantics.
 */
export async function mapPool<I, O>(
  items: readonly I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>
): Promise<PromiseSettledResult<O>[]> {
  const results: PromiseSettledResult<O>[] = new Array(items.length)
  let cursor = 0
  const limit = Math.max(1, Math.floor(concurrency))
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(runners)
  return results
}
