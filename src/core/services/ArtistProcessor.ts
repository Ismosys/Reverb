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

  /** One fan attempt. Throws on failure so withRetry can retry. */
  private async attempt(
    artist: DiscoveredArtist,
    startedAt: number,
    attempt: number,
    signal?: AbortSignal
  ): Promise<ArtistRecord> {
    const page = await this.ensureReverbPage(signal)

    // Resolve the real name cheaply (a title fetch, no full navigation).
    const realName = await this.resolveName(page, artist)
    if (realName !== artist.name) this.db.updateName(artist.artistId, realName)

    // Fan the artist (save to library + set updates) via the CSRF POST.
    const result = await this.library.save(page, { artistId: artist.artistId, name: realName }, this.settings.receiveUpdates)

    await this.human.betweenArtists(signal)

    const durationMs = Date.now() - startedAt
    const record = this.db.markResult(artist.artistId, {
      status: 'saved',
      updatesEnabled: result.updatesEnabled,
      failureReason: null,
      durationMs,
      incrementRetry: attempt > 0
    })
    this.log.info('artist', `Completed: ${realName}`, { artist: realName, status: 'saved', durationMs })
    return record
  }

  /**
   * Resolve the artist's display name by fetching its profile HTML `<title>`
   * from the page context (fast; no rendering). Falls back to any known name or
   * a stable id-based placeholder.
   */
  private async resolveName(page: Page, artist: DiscoveredArtist): Promise<string> {
    const fallback = artist.name && artist.name.length >= 2 ? artist.name : `Artist ${artist.artistId}`
    try {
      const title = await page.evaluate(async (id) => {
        const g = globalThis as unknown as {
          fetch: (u: string, o: unknown) => Promise<{ text: () => Promise<string> }>
        }
        const html = await g.fetch(`/artist/${id}`, { credentials: 'same-origin' }).then((r) => r.text())
        const m = html.match(/<title>([^<]*)<\/title>/i)
        return m ? m[1] : ''
      }, artist.artistId)
      const name = title.split('|')[0].trim()
      return name.length >= 2 ? name : fallback
    } catch {
      return fallback
    }
  }

  /** Ensure the shared page is on reverbnation.com so POST/fetch are same-origin. */
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
