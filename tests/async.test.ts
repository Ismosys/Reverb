import { describe, expect, it, vi } from 'vitest'
import { mapPool, randomInt, sleep, withRetry, withTimeout } from '@core/utils/async'
import { AppError } from '@core/utils/errors'

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn, { retries: 3 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until it succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('boom')
      return 'done'
    })
    await expect(withRetry(fn, { retries: 5, baseDelayMs: 1 })).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws RETRY_EXHAUSTED after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'))
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' })
    // initial try + 2 retries
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops early when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new AppError('nope', { recoverable: false }))
    await expect(
      withRetry(fn, { retries: 5, baseDelayMs: 1, shouldRetry: (e) => !(e instanceof AppError && !e.recoverable) })
    ).rejects.toBeTruthy()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('invokes onRetry with the attempt number', async () => {
    const onRetry = vi.fn()
    let calls = 0
    await withRetry(
      async () => {
        calls++
        if (calls < 2) throw new Error('x')
        return 1
      },
      { retries: 3, baseDelayMs: 1, onRetry }
    )
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
  })

  it('aborts when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(withRetry(fn, { retries: 3, signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42)
  })

  it('rejects with TIMEOUT when too slow', async () => {
    const slow = sleep(50).then(() => 'late')
    await expect(withTimeout(slow, 5, 'unit')).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('passes the promise through unchanged when ms <= 0', async () => {
    await expect(withTimeout(Promise.resolve('x'), 0)).resolves.toBe('x')
  })
})

describe('randomInt', () => {
  it('stays within the inclusive range', () => {
    for (let i = 0; i < 500; i++) {
      const n = randomInt(3, 7)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
    }
  })

  it('handles a collapsed range', () => {
    expect(randomInt(5, 5)).toBe(5)
    expect(randomInt(9, 2)).toBe(9)
  })
})

describe('mapPool', () => {
  it('preserves input order in results', async () => {
    const items = [10, 20, 30, 40]
    const res = await mapPool(items, 2, async (n) => n * 2)
    expect(res.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([20, 40, 60, 80])
  })

  it('captures rejections without failing the pool', async () => {
    const res = await mapPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('bad 2')
      return n
    })
    expect(res[0]).toMatchObject({ status: 'fulfilled', value: 1 })
    expect(res[1].status).toBe('rejected')
    expect(res[2]).toMatchObject({ status: 'fulfilled', value: 3 })
  })

  it('never runs more than `concurrency` workers at once', async () => {
    let active = 0
    let peak = 0
    await mapPool(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active++
      peak = Math.max(peak, active)
      await sleep(5)
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })
})
