import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Logger } from '../logging/Logger'
import { withRetry } from '../utils/async'
import { RecoverableError } from '../utils/errors'

/**
 * Page navigation with built-in retry and stale-page recovery. Every navigation
 * goes through here so retry/refresh policy lives in one place.
 */
export class NavigationService {
  constructor(
    private readonly browser: BrowserManager,
    private readonly site: SiteSelectors,
    private readonly log: Logger
  ) {}

  /** Navigate to a path (relative to baseUrl) with retries and load waiting. */
  async goto(path: string, opts: { retries: number; signal?: AbortSignal } = { retries: 3 }): Promise<Page> {
    const url = path.startsWith('http') ? path : `${this.site.baseUrl}${path}`
    return withRetry(
      async () => {
        const page = await this.browser.getPage()
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded' })
        if (resp && resp.status() >= 500) {
          throw new RecoverableError(`Server returned ${resp.status()} for ${url}`)
        }
        await this.settle(page)
        return page
      },
      {
        retries: opts.retries,
        signal: opts.signal,
        onRetry: (attempt, err) =>
          this.log.warn('navigate', `Retry ${attempt} navigating to ${url}`, {
            retryCount: attempt,
            error: err instanceof Error ? err.message : String(err)
          })
      }
    )
  }

  /** Navigate to the "Trending in the Community" page. */
  async gotoTrending(opts: { retries: number; signal?: AbortSignal }): Promise<Page> {
    this.log.info('navigate', 'Opening Trending in the Community')
    const page = await this.goto(this.site.trendingPath, opts)
    // Wait for at least one artist card (content finished loading).
    await page
      .locator(this.site.artistCard)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {
        this.log.warn('navigate', 'No artist cards visible yet on trending page')
      })
    return page
  }

  /** Refresh the current page (used to recover from a stale/errored view). */
  async refresh(signal?: AbortSignal): Promise<Page> {
    const page = await this.browser.getPage()
    this.log.info('navigate', 'Refreshing page to recover from stale state')
    return withRetry(
      async () => {
        await page.reload({ waitUntil: 'domcontentloaded' })
        await this.settle(page)
        return page
      },
      { retries: 2, signal }
    )
  }

  /** Wait for the network/DOM to be reasonably idle. */
  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  }
}
