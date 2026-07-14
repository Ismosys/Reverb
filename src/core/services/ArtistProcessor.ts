import type { Page } from 'playwright'
import type { ArtistRecord, AutomationSettings } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Database } from '../db/Database'
import type { Logger } from '../logging/Logger'
import type { DiscoveredArtist } from './TrendingScanner'
import type { LibraryManager, SaveResult, StatusReporter } from './LibraryManager'
import type { HumanBehavior } from './HumanBehavior'
import { withRetry } from '../utils/async'
import { AppError, toMessage } from '../utils/errors'

export type ProcessOutcome = 'saved' | 'skipped' | 'failed'

export interface ProcessResult {
  outcome: ProcessOutcome
  record: ArtistRecord
}

export interface ProcessOptions {
  /** 'row' drives the on-page three-dot menu; 'profile' visits the profile. */
  mode: 'row' | 'profile'
  locationLabel: string | null
  /** The row already shows as saved — skip without opening its menu. */
  knownSaved?: boolean
  onStatus?: StatusReporter
  signal?: AbortSignal
}

/**
 * Processes a single artist end-to-end: skip-if-done, run the human-paced DOM
 * "Add to Library" interaction (retried on transient UI failures), verify, and
 * persist the outcome. One bad artist never aborts the run — failures are
 * recorded and returned, not thrown.
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

  async process(artist: DiscoveredArtist, opts: ProcessOptions): Promise<ProcessResult> {
    const startedAt = Date.now()
    const status = opts.onStatus ?? (() => undefined)

    // Persist discovery; short-circuit if already completed in a prior run,
    // or if the row already shows as in the library (no menu needed).
    const existing = this.db.upsertDiscovered({ ...artist, locationLabel: opts.locationLabel })
    if (existing.status === 'saved') {
      status('Already in library')
      return { outcome: 'skipped', record: existing }
    }
    if (opts.knownSaved) {
      status('Already in library')
      this.log.info('artist', `Skip (already in library): ${artist.name}`, { artist: artist.name, status: 'skipped' })
      const record = this.db.markResult(artist.artistId, {
        status: 'skipped',
        updatesEnabled: true,
        failureReason: null,
        durationMs: 0
      })
      return { outcome: 'skipped', record }
    }
    this.db.markProcessing(artist.artistId)

    try {
      const { result, attempts } = await this.runWithRetries(artist, opts, startedAt)
      const durationMs = Date.now() - startedAt

      if (result.outcome === 'skipped') {
        const record = this.db.markResult(artist.artistId, {
          status: 'skipped',
          updatesEnabled: result.updatesEnabled,
          failureReason: null,
          durationMs,
          incrementRetry: attempts > 0
        })
        return { outcome: 'skipped', record }
      }

      const record = this.db.markResult(artist.artistId, {
        status: 'saved',
        updatesEnabled: result.updatesEnabled,
        failureReason: null,
        durationMs,
        incrementRetry: attempts > 0
      })
      this.log.info('artist', `Completed: ${artist.name}`, { artist: artist.name, status: 'saved', durationMs })
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

  /** Run the chosen DOM flow, retrying transient UI failures. */
  private async runWithRetries(
    artist: DiscoveredArtist,
    opts: ProcessOptions,
    _startedAt: number
  ): Promise<{ result: SaveResult; attempts: number }> {
    let attempts = 0
    const result = await withRetry(
      async (attempt) => {
        attempts = attempt
        const page = await this.ensureReverbPage(opts.signal)
        const save: SaveResult =
          opts.mode === 'row'
            ? await this.library.addViaRowMenu(page, { id: artist.artistId, name: artist.name }, this.saveOpts(opts))
            : await this.library.addViaProfile(
                page,
                { id: artist.artistId, name: artist.name, profileUrl: artist.profileUrl },
                this.saveOpts(opts)
              )
        // Pace between artists (human-like) after a successful action.
        if (save.outcome === 'saved') await this.human.betweenArtists(opts.signal)
        return save
      },
      {
        retries: this.settings.maxRetries,
        signal: opts.signal,
        shouldRetry: (err) => !(err instanceof AppError && err.recoverable === false),
        onRetry: (attempt, err) => {
          opts.onStatus?.(`Retrying (${attempt})…`)
          this.log.warn('artist', `Retry ${attempt} for ${artist.name}`, {
            artist: artist.name,
            retryCount: attempt,
            error: toMessage(err)
          })
        }
      }
    )
    return { result, attempts }
  }

  private saveOpts(opts: ProcessOptions) {
    return {
      receiveUpdates: this.settings.receiveUpdates,
      onStatus: opts.onStatus,
      signal: opts.signal
    }
  }

  /** Ensure the shared page is on reverbnation.com for same-origin actions. */
  private async ensureReverbPage(signal?: AbortSignal): Promise<Page> {
    const page = await this.browser.getPage()
    if (!/reverbnation\.com/.test(page.url())) {
      await page.goto('https://www.reverbnation.com/main/charts', { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
    }
    if (signal?.aborted) throw new AppError('Aborted', { code: 'ABORTED' })
    return page
  }
}
