import type { Page } from 'playwright'
import type { ArtistRecord, AutomationSettings } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Database } from '../db/Database'
import type { Logger } from '../logging/Logger'
import type { DiscoveredArtist } from './TrendingScanner'
import type { LibraryManager } from './LibraryManager'
import type { UpdatesManager } from './UpdatesManager'
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
    private readonly updates: UpdatesManager,
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

    const saved = await this.library.save(page, artist.name, signal)
    if (!saved) throw new AppError(`Could not save ${artist.name}`, { code: 'SAVE', recoverable: true })

    let updatesEnabled = false
    if (this.settings.receiveUpdates) {
      updatesEnabled = await this.updates.enable(page, artist.name, signal)
    }

    await this.human.betweenArtists(signal)

    const durationMs = Date.now() - startedAt
    const record = this.db.markResult(artist.artistId, {
      status: 'saved',
      updatesEnabled,
      failureReason: null,
      durationMs,
      incrementRetry: attempt > 0
    })
    this.log.info('artist', `Completed: ${artist.name}`, {
      artist: artist.name,
      status: 'saved',
      durationMs
    })
    return record
  }

  /** Navigate to the artist profile when the action can't be done inline. */
  private async openProfile(url: string, signal?: AbortSignal): Promise<Page> {
    const page = await this.browser.getPage()
    if (!page.url().startsWith(url)) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined)
    }
    if (signal?.aborted) throw new AppError('Aborted', { code: 'ABORTED' })
    return page
  }
}
