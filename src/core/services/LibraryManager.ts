import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { sleep } from '../utils/async'
import { RecoverableError } from '../utils/errors'

export interface SaveResult {
  saved: boolean
  updatesEnabled: boolean
  alreadySaved: boolean
}

/**
 * Saves an artist to the user's library via ReverbNation's "Become a Fan" flow
 * and, in the same interaction, sets update notifications.
 *
 * Flow (verified live): on an artist profile, "Become a Fan"
 * (`a.button--add--profile`) starts fanning; a "receive updates?" prompt then
 * offers Yes/No (`a.js-fan-action`). When already a fan, "Remove Fan"
 * (`a.button--added--profile`) is shown instead — our "already saved" signal.
 */
export class LibraryManager {
  constructor(
    private readonly site: SiteSelectors,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {}

  /** True if the artist profile currently shows "Remove Fan" (already a fan). */
  async isSaved(page: Page): Promise<boolean> {
    return page
      .locator(this.site.removeFanButton)
      .first()
      .isVisible()
      .catch(() => false)
  }

  /**
   * Save the artist on `page`, enabling updates when `receiveUpdates` is true.
   * Throws RecoverableError on transient failures so the caller can retry.
   */
  async save(page: Page, artistName: string, receiveUpdates: boolean, signal?: AbortSignal): Promise<SaveResult> {
    if (await this.isSaved(page)) {
      this.log.info('save', `Already a fan: ${artistName}`, { artist: artistName, status: 'skipped' })
      return { saved: true, updatesEnabled: true, alreadySaved: true }
    }

    const becomeFan = page.locator(this.site.becomeFanButton).first()
    if (!(await becomeFan.isVisible().catch(() => false))) {
      throw new RecoverableError(`"Become a Fan" not found for ${artistName}`)
    }

    await this.human.click(page, this.site.becomeFanButton, signal)
    await sleep(1200, signal)

    // Handle the receive-updates prompt if it appears.
    let updatesEnabled = false
    const promptSelector = receiveUpdates ? this.site.fanConfirmYes : this.site.fanConfirmNo
    const prompt = page.locator(promptSelector).first()
    if (await prompt.isVisible().catch(() => false)) {
      await this.human.click(page, promptSelector, signal)
      updatesEnabled = receiveUpdates
      await sleep(1000, signal)
    } else {
      this.log.debug('save', `No updates prompt for ${artistName}`, { artist: artistName })
    }

    // Verify the fan action took effect.
    const confirmed = await page
      .locator(this.site.removeFanButton)
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)

    if (!confirmed) {
      throw new RecoverableError(`Fan action not confirmed for ${artistName}`)
    }
    this.log.info('save', `Saved to library: ${artistName}${updatesEnabled ? ' (updates on)' : ''}`, {
      artist: artistName
    })
    return { saved: true, updatesEnabled, alreadySaved: false }
  }
}
