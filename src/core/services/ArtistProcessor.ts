import type { Page } from 'playwright'
import type { ArtistRecord, AutomationSettings } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Database } from '../db/Database'
import type { Logger } from '../logging/Logger'
import type { DiscoveredArtist } from './TrendingScanner'
import type { LibraryManager } from './LibraryManager'
import type { HumanBehavior } from './HumanBehavior'
import { withRetry } from '../utils/async'
import { AppError, toMessage } from '../utils/errors'

export type ProcessOutcome = 'saved' | 'skipped' | 'failed'

export interface ProcessResult {
  outcome: ProcessOutcome
  record: ArtistRecord
}

/**
 * Processes a single artist end-to-end: skip-if-done, open profile, save,
 * enable updates, verify, and persist the outcome. All transient failures are
 * retried; a non-recoverable failure is recorded and returned rather than
 * thrown, so one bad artist never aborts the run.
 */
export class ArtistProcessor {
  constructor(
    private readonly browser: BrowserManager,
    private readonly db: Database,
    private readonly library: LibraryManager,
    private readonly human: HumanBehavior,
    private readonly settings: AutomationSettings,
    private readonly log: Logger
  ) {}

  async process(
    artist: DiscoveredArtist,
    locationLabel: string | null,
    signal?: AbortSignal
  ): Promise<ProcessResult> {
    const startedAt = Date.now()

    // 1. Persist discovery and short-circuit if already completed.
    const existing = this.db.upsertDiscovered({ ...artist, locationLabel })
    if (existing.status === 'saved') {
      this.log.info('artist', `Skip (already saved): ${artist.name}`, { artist: artist.name, status: 'skipped' })
      return { outcome: 'skipped', record: existing }
    }

    this.db.markProcessing(artist.artistId)

    try {
      const record = await withRetry(
        async (attempt) => this.attempt(artist, startedAt, attempt, signal),
        {
          retries: this.settings.maxRetries,
          signal,
          shouldRetry: (err) => !(err instanceof AppError && err.recoverable === false),
          onRetry: (attempt, err) =>
            this.log.warn('artist', `Retry ${attempt} for ${artist.name}`, {
              artist: artist.name,
              retryCount: attempt,
              error: toMessage(err)
            })
        }
      )
      return { outcome: 'saved', record }
    } catch (err) {
      const durationMs = Date.now() - startedAt
      const record = this.db.markResult(artist.artistId, {
        status: 'failed',
        failureReason: toMessage(err),
        durationMs,
        incrementRetry: true
      })
      this.log.error('artist', `Failed: ${artist.name}`, {
        artist: artist.name,
        status: 'failed',
        durationMs,
        error: toMessage(err)
      })
      return { outcome: 'failed', record }
    }
  }

  /** One save+updates attempt. Throws on failure so withRetry can retry. */
  private async attempt(
    artist: DiscoveredArtist,
    startedAt: number,
    attempt: number,
    signal?: AbortSignal
  ): Promise<ArtistRecord> {
    const page = await this.openProfile(artist.profileUrl, signal)

    // Resolve the authoritative artist name from the profile page title.
    const realName = await this.resolveName(page, artist.name)
    if (realName !== artist.name) this.db.updateName(artist.artistId, realName)

    // Save + set updates in one flow ("Become a Fan" → Yes/No prompt).
    const result = await this.library.save(page, realName, this.settings.receiveUpdates, signal)

    await this.human.betweenArtists(signal)

    const durationMs = Date.now() - startedAt
    const record = this.db.markResult(artist.artistId, {
      status: 'saved',
      updatesEnabled: result.updatesEnabled,
      failureReason: null,
      durationMs,
      incrementRetry: attempt > 0
    })
    this.log.info('artist', `Completed: ${realName}${result.alreadySaved ? ' (already a fan)' : ''}`, {
      artist: realName,
      status: 'saved',
      durationMs
    })
    return record
  }

  /** Read the artist's display name from the profile page `<title>`. */
  private async resolveName(page: Page, fallback: string): Promise<string> {
    try {
      const title = await page.title()
      // ReverbNation titles are "Artist Name | ReverbNation".
      const name = title.split('|')[0].trim()
      return name.length >= 2 ? name : fallback
    } catch {
      return fallback
    }
  }

  /** Navigate to the artist profile when the action can't be done inline. */
  private async openProfile(url: string, signal?: AbortSignal): Promise<Page> {
    const page = await this.browser.getPage()
    if (!page.url().startsWith(url)) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
    }
    if (signal?.aborted) throw new AppError('Aborted', { code: 'ABORTED' })
    return page
  }
}
