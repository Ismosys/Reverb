/**
 * Distribute `total` as evenly as possible across `buckets`, front-loading the
 * remainder. The returned array sums exactly to `max(0, total)`.
 *
 *   splitEvenly(10, 3) → [4, 3, 3]
 *   splitEvenly(5, 8)  → [1, 1, 1, 1, 1, 0, 0, 0]
 *   splitEvenly(7, 1)  → [7]
 */
export function splitEvenly(total: number, buckets: number): number[] {
  const n = Math.max(0, Math.floor(buckets))
  if (n === 0) return []
  const t = Math.max(0, Math.floor(total))
  const base = Math.floor(t / n)
  const remainder = t % n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}
