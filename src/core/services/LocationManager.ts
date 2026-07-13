import type { Page } from 'playwright'
import type { SiteSelectors, TrendingLocation } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { NavigationService } from './NavigationService'
import type { HumanBehavior } from './HumanBehavior'

/**
 * Applies a trending location before scanning.
 *
 * ReverbNation exposes location in different ways over time, so this tries a
 * layered strategy and stops at the first that works:
 *   1. A native <select> / dropdown selector, if present.
 *   2. A free-text search input with an option list.
 *   3. A URL query parameter fallback (?location=...), which many trending
 *      endpoints honour and is the most robust when markup shifts.
 */
export class LocationManager {
  constructor(
    private readonly site: SiteSelectors,
    private readonly nav: NavigationService,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {}

  /** Apply `location` on `page`. Returns true if a method succeeded. */
  async apply(page: Page, location: TrendingLocation, signal?: AbortSignal): Promise<boolean> {
    if (location.id === 'global') {
      this.log.info('location', 'Global location — no filter applied')
      return true
    }
    this.log.info('location', `Applying location: ${location.label}`)

    if (await this.trySelector(page, location, signal)) return true
    if (await this.trySearch(page, location, signal)) return true
    if (await this.tryUrlParam(location, signal)) return true

    this.log.warn('location', `Could not apply location "${location.label}" via any method`, { status: 'degraded' })
    return false
  }

  private async trySelector(page: Page, location: TrendingLocation, signal?: AbortSignal): Promise<boolean> {
    const selector = page.locator(this.site.locationSelector).first()
    if (!(await selector.isVisible().catch(() => false))) return false
    try {
      const tag = await selector.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')
      if (tag === 'select') {
        await selector.selectOption({ label: location.label }).catch(async () => {
          await selector.selectOption({ value: location.label })
        })
      } else {
        await this.human.click(page, this.site.locationSelector, signal)
        await page.locator(this.site.locationOption, { hasText: location.label }).first().click({ timeout: 6000 })
      }
      await this.nav.refresh(signal)
      this.log.info('location', `Location applied via selector: ${location.label}`)
      return true
    } catch (err) {
      this.log.debug('location', 'Selector method failed', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  private async trySearch(page: Page, location: TrendingLocation, signal?: AbortSignal): Promise<boolean> {
    const input = page.locator(this.site.locationSearchInput).first()
    if (!(await input.isVisible().catch(() => false))) return false
    try {
      await input.click()
      await input.fill('')
      // Type the most specific term available.
      const term = location.city ?? location.state ?? location.country ?? location.region ?? location.label
      await input.type(term, { delay: 90 })
      await this.human.aroundClick(signal)
      const option = page.locator(this.site.locationOption, { hasText: location.label }).first()
      await option.waitFor({ state: 'visible', timeout: 6000 })
      await option.click()
      await this.nav.refresh(signal)
      this.log.info('location', `Location applied via search: ${location.label}`)
      return true
    } catch (err) {
      this.log.debug('location', 'Search method failed', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  private async tryUrlParam(location: TrendingLocation, signal?: AbortSignal): Promise<boolean> {
    try {
      const params = new URLSearchParams()
      if (location.country) params.set('country', location.country)
      if (location.state) params.set('state', location.state)
      if (location.city) params.set('city', location.city)
      if (location.region) params.set('region', location.region)
      params.set('location', location.label)
      const path = `${this.site.trendingPath}?${params.toString()}`
      await this.nav.goto(path, { retries: 2, signal })
      this.log.info('location', `Location applied via URL parameter: ${location.label}`)
      return true
    } catch (err) {
      this.log.debug('location', 'URL param method failed', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }
}
