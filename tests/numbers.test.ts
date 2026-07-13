import { describe, expect, it } from 'vitest'
import { splitEvenly } from '@core/utils/numbers'

describe('splitEvenly', () => {
  it('divides evenly when it divides cleanly', () => {
    expect(splitEvenly(9, 3)).toEqual([3, 3, 3])
  })

  it('front-loads the remainder', () => {
    expect(splitEvenly(10, 3)).toEqual([4, 3, 3])
    expect(splitEvenly(11, 3)).toEqual([4, 4, 3])
  })

  it('gives everything to a single bucket', () => {
    expect(splitEvenly(7, 1)).toEqual([7])
  })

  it('handles more buckets than total (trailing zeros)', () => {
    expect(splitEvenly(2, 5)).toEqual([1, 1, 0, 0, 0])
  })

  it('always sums to the total', () => {
    for (const [total, buckets] of [
      [25, 4],
      [100, 7],
      [3, 3],
      [0, 5]
    ] as const) {
      const parts = splitEvenly(total, buckets)
      expect(parts).toHaveLength(buckets)
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('returns [] for zero or negative buckets', () => {
    expect(splitEvenly(10, 0)).toEqual([])
    expect(splitEvenly(10, -2)).toEqual([])
  })

  it('clamps a negative total to zero', () => {
    expect(splitEvenly(-5, 2)).toEqual([0, 0])
  })
})
