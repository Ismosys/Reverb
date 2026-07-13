import type { Page } from 'playwright'
import type { AutomationSettings } from '@shared/types'
import { jitter, randomInt, sleep } from '../utils/async'

/**
 * Encapsulates the "act like a person" pacing: randomised delays, natural
 * scrolling and variable click timing. Centralising this keeps rate-limiting
 * behaviour consistent across every service.
 */
export class HumanBehavior {
  constructor(private readonly settings: AutomationSettings) {}

  /** Pause a randomised amount between discrete artist operations. */
  betweenArtists(signal?: AbortSignal): Promise<void> {
    return jitter(this.settings.randomDelay, signal)
  }

  /** Small variable pause around a click. */
  aroundClick(signal?: AbortSignal): Promise<void> {
    return jitter(this.settings.clickDelay, signal)
  }

  /**
   * Human-like click: move cursor near the target, brief hover, then click.
   * Falls back to a plain click if the element cannot be hovered.
   */
  async click(page: Page, selector: string, signal?: AbortSignal): Promise<void> {
    await this.aroundClick(signal)
    const el = page.locator(selector).first()
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 5000 })
      await el.hover({ timeout: 3000 })
      await sleep(randomInt(80, 320), signal)
    } catch {
      // Hover is a nicety, not a requirement.
    }
    await el.click({ timeout: 8000 })
  }

  /**
   * Scroll the page in natural-sized increments until either `maxSteps` is hit
   * or `isDone()` returns true (e.g. target artist count reached). Returns the
   * number of scroll steps performed.
   */
  async scrollUntil(
    page: Page,
    opts: { maxSteps: number; isDone: () => Promise<boolean> | boolean; signal?: AbortSignal }
  ): Promise<number> {
    let steps = 0
    let stagnant = 0
    let lastHeight = 0
    while (steps < opts.maxSteps) {
      if (opts.signal?.aborted) break
      if (await opts.isDone()) break

      const delta = this.settings.scrollSpeed + randomInt(-120, 160)
      await page.mouse.wheel(0, Math.max(120, delta))
      steps++
      await sleep(randomInt(500, 1100), opts.signal)

      // Detect "no new content" so we don't scroll a dead page forever.
      const height = await page
        .evaluate(() => (globalThis as unknown as { document: { body: { scrollHeight: number } } }).document.body.scrollHeight)
        .catch(() => lastHeight)
      if (height <= lastHeight) {
        stagnant++
        if (stagnant >= 3) break
      } else {
        stagnant = 0
        lastHeight = height
      }
    }
    return steps
  }
}
