import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { RecoverableError } from '../utils/errors'

/**
 * Saves an artist to the user's library and verifies the action took effect.
 * Works whether the Save control lives on the trending card or the artist's
 * profile page.
 */
export class LibraryManager {
  constructor(
    private readonly site: SiteSelectors,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {}

  /** True if `page` already shows the artist as saved. */
  async isSaved(page: Page): Promise<boolean> {
    return page
      .locator(this.site.savedState)
      .first()
      .isVisible()
      .catch(() => false)
  }

  /**
   * Save the artist currently shown on `page`. Returns true when saved (or was
   * already saved). Throws RecoverableError on transient failures so the caller
   * can retry.
   */
  async save(page: Page, artistName: string, signal?: AbortSignal): Promise<boolean> {
    if (await this.isSaved(page)) {
      this.log.info('save', `Already saved: ${artistName}`, { artist: artistName, status: 'skipped' })
      return true
    }

    const button = page.locator(this.site.saveButton).first()
    const present = await button.isVisible().catch(() => false)
    if (!present) {
      throw new RecoverableError(`Save button not found for ${artistName}`)
    }

    await this.human.click(page, this.site.saveButton, signal)

    // Verify the action: wait for the saved-state indicator to appear.
    const confirmed = await page
      .locator(this.site.savedState)
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)

    if (!confirmed) {
      throw new RecoverableError(`Save not confirmed for ${artistName}`)
    }
    this.log.info('save', `Saved to library: ${artistName}`, { artist: artistName })
    return true
  }
}
