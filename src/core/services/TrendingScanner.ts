import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { sleep } from '../utils/async'

/** A lightweight artist descriptor scraped from the charts. */
export interface DiscoveredArtist {
  /** Numeric ReverbNation artist id (from the fan-save control). */
  artistId: string
  /** Best-effort name; resolved authoritatively during processing. */
  name: string
  /** Canonical profile URL (`/artist/<id>`), which resolves to the artist. */
  profileUrl: string
}

/**
 * Discovers trending artists from ReverbNation Charts.
 *
 * The chart is paginated (~15 artists/page, `qa-next-page`) and filtered by
 * genre (`select[name="genre"]`, ~45 genres). Each artist is identified by the
 * numeric id embedded in its `became_fan_save` control. To reach large targets
 * we paginate the current genre, then move to the next genre, accumulating
 * distinct ids until the target is met (or sources are exhausted). Geo scope is
 * applied by LocationManager before scanning and is preserved across genres.
 */
export class TrendingScanner {
  /** Safety cap on pages walked per genre. */
  private static readonly MAX_PAGES_PER_GENRE = 80

  constructor(
    private readonly site: SiteSelectors,
    private readonly _human: HumanBehavior,
    private readonly log: Logger
  ) {
    void this._human
  }

  async scan(
    page: Page,
    opts: { target: number; maxScrollPages: number; signal?: AbortSignal }
  ): Promise<DiscoveredArtist[]> {
    const found = new Map<string, DiscoveredArtist>()
    const add = (ids: string[]): void => {
      for (const id of ids) {
        if (!found.has(id)) {
          found.set(id, { artistId: id, name: '', profileUrl: `${this.site.baseUrl}/artist/${id}` })
        }
      }
    }

    const genres = await this.genreValues(page)
    this.log.info('scan', `Charts scan starting: target ${opts.target}, ${genres.length} genre(s) available`)

    for (const genre of genres) {
      if (found.size >= opts.target || opts.signal?.aborted) break
      await this.setGenre(page, genre, opts.signal)

      let previousFirst: string | null = null
      for (let p = 0; p < TrendingScanner.MAX_PAGES_PER_GENRE; p++) {
        if (found.size >= opts.target || opts.signal?.aborted) break

        const ids = await this.pageIds(page)
        if (ids.length === 0) break
        // The chart didn't advance (same first id) → no more pages for this genre.
        if (previousFirst !== null && ids[0] === previousFirst) break
        previousFirst = ids[0]
        add(ids)

        const advanced = await this.nextPage(page, opts.signal)
        if (!advanced) break
      }
      this.log.info('scan', `After genre "${genre}": ${found.size}/${opts.target} artist(s)`)
    }

    const result = Array.from(found.values()).slice(0, opts.target)
    this.log.info('scan', `Scan complete: ${result.length} artist(s)`, {
      status: result.length >= opts.target ? 'ok' : 'partial'
    })
    return result
  }

  /** Read the genre option values, putting the current/default first. */
  private async genreValues(page: Page): Promise<string[]> {
    const values = await page
      .evaluate(() => {
        const g = globalThis as unknown as {
          document: { querySelector: (s: string) => { options?: ArrayLike<{ value: string }> } | null }
        }
        const sel = g.document.querySelector('select[name="genre"]')
        if (!sel || !sel.options) return [] as string[]
        return Array.from(sel.options).map((o) => o.value).filter(Boolean)
      })
      .catch(() => [] as string[])
    if (values.length === 0) return ['string:all']
    // Visit "All Genres" first, then the rest.
    const all = values.filter((v) => /:all$/.test(v))
    const rest = values.filter((v) => !/:all$/.test(v))
    return [...all, ...rest]
  }

  /** Extract distinct artist ids from the fan-save controls on the current page. */
  private async pageIds(page: Page): Promise<string[]> {
    return page
      .evaluate(() => {
        const g = globalThis as unknown as {
          document: { querySelectorAll: (s: string) => ArrayLike<{ getAttribute: (n: string) => string | null }> }
        }
        const out: string[] = []
        const seen = new Set<string>()
        const links = Array.from(g.document.querySelectorAll('a[href*="became_fan_save"]'))
        for (const a of links) {
          const m = (a.getAttribute('href') || '').match(/artist_(\d+)/)
          if (m && !seen.has(m[1])) {
            seen.add(m[1])
            out.push(m[1])
          }
        }
        return out
      })
      .catch(() => [] as string[])
  }

  /** Select a genre and wait for the chart to refresh. */
  private async setGenre(page: Page, genre: string, signal?: AbortSignal): Promise<void> {
    try {
      await page.selectOption('select[name="genre"]', genre)
    } catch {
      await page
        .evaluate((value) => {
          const g = globalThis as unknown as {
            document: { querySelector: (s: string) => { value: string; options: ArrayLike<{ value: string }>; dispatchEvent: (e: unknown) => void } | null }
            Event: new (t: string, o: { bubbles: boolean }) => unknown
          }
          const sel = g.document.querySelector('select[name="genre"]')
          if (sel) {
            sel.value = value
            sel.dispatchEvent(new g.Event('change', { bubbles: true }))
          }
        }, genre)
        .catch(() => undefined)
    }
    await sleep(2200, signal)
  }

  /** Click "next page"; returns true if the page advanced. */
  private async nextPage(page: Page, signal?: AbortSignal): Promise<boolean> {
    const next = page.locator('a.qa-next-page').first()
    const visible = await next.isVisible().catch(() => false)
    if (!visible) return false
    const before = (await this.pageIds(page))[0] ?? null
    await next.click({ timeout: 6000 }).catch(() => undefined)
    await sleep(1800, signal)
    const after = (await this.pageIds(page))[0] ?? null
    return after !== null && after !== before
  }
}
