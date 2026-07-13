import type { Page } from 'playwright'
import type { SiteSelectors, TrendingLocation } from '@shared/types'
import type { Logger } from '../logging/Logger'
import { sleep } from '../utils/async'

/**
 * Applies a trending geo scope on the ReverbNation Charts page.
 *
 * The charts page exposes a single `<select name="geo">` with four AngularJS
 * options (Global / National / Regional / Local). We set the select's value and
 * dispatch the `change` event Angular listens for, then wait for the list to
 * refresh.
 */
export class LocationManager {
  constructor(
    private readonly site: SiteSelectors,
    private readonly log: Logger
  ) {}

  /** Apply `location`'s geo scope on `page` (the charts page). */
  async apply(page: Page, location: TrendingLocation, signal?: AbortSignal): Promise<boolean> {
    const select = page.locator(this.site.geoSelect).first()
    if (!(await select.isVisible().catch(() => false))) {
      this.log.warn('location', 'Geo select not found on charts page', { status: 'degraded' })
      return false
    }

    try {
      // Prefer Playwright's selectOption (by value, then by visible label).
      const applied = await select
        .selectOption(location.geoValue)
        .then(() => true)
        .catch(async () => {
          return select
            .selectOption({ label: location.label })
            .then(() => true)
            .catch(() => false)
        })

      if (!applied) {
        // Fallback: set the value directly and fire the events Angular needs.
        await select.evaluate((el, value) => {
          const sel = el as unknown as {
            options: ArrayLike<{ value: string; text: string }>
            value: string
            dispatchEvent: (e: unknown) => void
          }
          const g = globalThis as unknown as { Event: new (t: string, o: { bubbles: boolean }) => unknown }
          const match = Array.from(sel.options).find((o) => o.value === value || o.text.trim() === value)
          if (match) sel.value = match.value
          sel.dispatchEvent(new g.Event('change', { bubbles: true }))
          sel.dispatchEvent(new g.Event('input', { bubbles: true }))
        }, location.geoValue)
      }

      await sleep(2500, signal)
      this.log.info('location', `Applied geo scope: ${location.label}`)
      return true
    } catch (err) {
      this.log.warn('location', `Failed to apply geo scope "${location.label}"`, {
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }
}
