import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { RecoverableError } from '../utils/errors'

/**
 * Enables "Receive updates" / notifications for a saved artist and verifies it.
 * Enabling updates is treated as best-effort by default: an artist that saved
 * successfully but whose updates toggle is absent should not fail the whole
 * artist — the caller decides based on the returned boolean.
 */
export class UpdatesManager {
  constructor(
    private readonly site: SiteSelectors,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {}

  async isEnabled(page: Page): Promise<boolean> {
    return page
      .locator(this.site.updatesEnabledState)
      .first()
      .isVisible()
      .catch(() => false)
  }

  /**
   * Enable updates for the artist on `page`. Returns true when enabled.
   * When the control is simply not present, returns false without throwing.
   */
  async enable(page: Page, artistName: string, signal?: AbortSignal): Promise<boolean> {
    if (await this.isEnabled(page)) {
      this.log.info('updates', `Updates already enabled: ${artistName}`, { artist: artistName })
      return true
    }

    const button = page.locator(this.site.updatesButton).first()
    const present = await button.isVisible().catch(() => false)
    if (!present) {
      this.log.warn('updates', `Updates control not found for ${artistName}`, { artist: artistName, status: 'skipped' })
      return false
    }

    await this.human.click(page, this.site.updatesButton, signal)
    const confirmed = await page
      .locator(this.site.updatesEnabledState)
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false)

    if (!confirmed) {
      throw new RecoverableError(`Updates not confirmed for ${artistName}`)
    }
    this.log.info('updates', `Updates enabled: ${artistName}`, { artist: artistName })
    return true
  }
}
