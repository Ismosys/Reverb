import type { Page } from 'playwright'
import type { SiteSelectors, TrendingLocation } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { sleep } from '../utils/async'

/** A lightweight artist descriptor. */
export interface DiscoveredArtist {
  artistId: string
  name: string
  profileUrl: string
  /** For on-page rows: whether the row already shows as in the library. */
  alreadySaved?: boolean
}

/** One row from `/api/charts/*` (used for custom-location discovery). */
interface ChartResult {
  id: number
  name?: string
  homepage?: string
}

/**
 * Discovers trending artists.
 *
 * - For the community/global list we read the rendered chart rows in order (so
 *   the automation can drive their on-page menus exactly like a human) and
 *   paginate for more — mirroring the reference recording's scroll-to-load.
 * - For a custom location we use ReverbNation's local charts JSON API keyed by
 *   coordinates (there is no on-page list for arbitrary places).
 */
export class TrendingScanner {
  private static readonly MAX_PAGES_PER_GENRE = 60

  constructor(
    private readonly site: SiteSelectors,
    private readonly _human: HumanBehavior,
    private readonly log: Logger
  ) {
    void this._human
  }

  /* ------------------- On-page community rows (DOM) ------------------- */

  /** Read the currently-rendered chart rows, in top-to-bottom order. */
  async readRows(page: Page): Promise<DiscoveredArtist[]> {
    const base = this.site.baseUrl
    const rows = await page
      .evaluate(() => {
        type El = {
          id: string
          className: string
          closest: (s: string) => El | null
          querySelector: (s: string) => El | null
          textContent: string | null
        }
        const g = globalThis as unknown as { document: { querySelectorAll: (s: string) => ArrayLike<El> } }
        const out: Array<{ id: string; name: string; alreadySaved: boolean }> = []
        const seen = new Set<string>()
        const dropdowns = Array.from(g.document.querySelectorAll('ul[id^="charts_artist_"]'))
        for (const ul of dropdowns) {
          const id = ul.id.replace('charts_artist_', '')
          if (!id || seen.has(id)) continue
          seen.add(id)
          const row = ul.closest('.slat, .community-trending-chart-item, .chart-item, [class*="chart-item"], li, .row')
          const nameEl = row?.querySelector('.chart-item-title span, .h5-size.text-default, .primary, [class*="artist-name"], .name')
          const name = (nameEl?.textContent || '').trim().split('\n')[0].trim()
          // The "Save"/Add link carries class "hide" once the artist is a fan.
          const addLink = (row ?? ul).querySelector('a[data-fan-action="add"]')
          const alreadySaved = !!addLink && addLink.className.split(' ').includes('hide')
          out.push({ id, name: name.length > 1 ? name : `Artist ${id}`, alreadySaved })
        }
        return out
      })
      .catch(() => [] as Array<{ id: string; name: string; alreadySaved: boolean }>)

    return rows.map((r) => ({
      artistId: r.id,
      name: r.name,
      profileUrl: `${base}/artist/${r.id}`,
      alreadySaved: r.alreadySaved
    }))
  }

  /** Advance to the next page of rows; returns true if the list changed. */
  async nextPage(page: Page, signal?: AbortSignal): Promise<boolean> {
    // Close any lingering dropdown without navigating (Escape only).
    await page.keyboard.press('Escape').catch(() => undefined)
    const next = page.locator('a.qa-next-page').first()
    if (!(await next.isVisible().catch(() => false))) return false
    const firstBefore = (await this.readRows(page))[0]?.artistId ?? null
    await next.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined)
    await next.click({ timeout: 6000 }).catch(async () => {
      await next.click({ timeout: 4000, force: true }).catch(() => undefined)
    })
    // Intelligent wait: the first row id should change.
    await page
      .waitForFunction(
        (prev) => {
          const g = globalThis as unknown as { document: { querySelector: (s: string) => { id: string } | null } }
          const first = g.document.querySelector('ul[id^="charts_artist_"]')
          const id = first ? first.id.replace('charts_artist_', '') || null : null
          return id !== null && id !== prev
        },
        firstBefore,
        { timeout: 8000, polling: 250 }
      )
      .catch(() => undefined)
    await sleep(400, signal).catch(() => undefined)
    const firstAfter = (await this.readRows(page))[0]?.artistId ?? null
    return firstAfter !== null && firstAfter !== firstBefore
  }

  /** Available genre values on the charts page (plain names). */
  async genres(page: Page): Promise<string[]> {
    return this.genreValues(page)
  }

  /** Switch the charts genre filter and wait for the row list to change. */
  async setGenre(page: Page, genre: string, signal?: AbortSignal): Promise<void> {
    const firstBefore = (await this.readRows(page))[0]?.artistId ?? null
    const value = `string:${genre}`
    await page.selectOption('select[name="genre"]', value).catch(async () => {
      await page
        .evaluate((v) => {
          const g = globalThis as unknown as {
            document: { querySelector: (s: string) => { value: string; dispatchEvent: (e: unknown) => void } | null }
            Event: new (t: string, o: { bubbles: boolean }) => unknown
          }
          const sel = g.document.querySelector('select[name="genre"]')
          if (sel) {
            sel.value = v
            sel.dispatchEvent(new g.Event('change', { bubbles: true }))
          }
        }, value)
        .catch(() => undefined)
    })
    await page
      .waitForFunction(
        (prev) => {
          const g = globalThis as unknown as { document: { querySelector: (s: string) => { id: string } | null } }
          const first = g.document.querySelector('ul[id^="charts_artist_"]')
          const id = first ? first.id.replace('charts_artist_', '') || null : null
          return id !== null && id !== prev
        },
        firstBefore,
        { timeout: 8000, polling: 250 }
      )
      .catch(() => undefined)
    await sleep(300, signal).catch(() => undefined)
  }

  /* --------------------- Custom location (JSON API) -------------------- */

  /** Discover artists for a custom (coordinate) location via the charts API. */
  async scanApi(
    page: Page,
    opts: { target: number; location: TrendingLocation; signal?: AbortSignal }
  ): Promise<DiscoveredArtist[]> {
    const found = new Map<string, DiscoveredArtist>()
    const genres = ['', ...(await this.genreValues(page))]
    this.log.info('scan', `Local charts API scan for ${opts.location.label} (target ${opts.target})`)

    for (const genre of genres) {
      if (found.size >= opts.target || opts.signal?.aborted) break
      for (let pageNum = 1; pageNum <= TrendingScanner.MAX_PAGES_PER_GENRE; pageNum++) {
        if (found.size >= opts.target || opts.signal?.aborted) break
        const artists = await this.fetchApiPage(page, opts.location, genre, pageNum)
        if (artists.length === 0) break
        let added = 0
        for (const a of artists) if (!found.has(a.artistId)) (found.set(a.artistId, a), added++)
        if (added === 0 && pageNum > 1) break
        await sleep(150, opts.signal)
      }
    }
    return Array.from(found.values()).slice(0, opts.target)
  }

  private async fetchApiPage(
    page: Page,
    location: TrendingLocation,
    genre: string,
    pageNum: number
  ): Promise<DiscoveredArtist[]> {
    const params = [`page=${pageNum}`]
    if (genre) params.push(`genre=${encodeURIComponent(genre)}`)
    const path =
      `/api/charts/local?location[latitude]=${location.latitude}` +
      `&location[longitude]=${location.longitude}&${params.join('&')}`

    const results = await page
      .evaluate(async (url: string) => {
        const g = globalThis as unknown as {
          fetch: (u: string, o: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
        }
        try {
          const r = await g.fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
          if (!r.ok) return []
          const j = (await r.json()) as { results?: unknown }
          return Array.isArray(j.results) ? j.results : []
        } catch {
          return []
        }
      }, path)
      .catch(() => [] as unknown[])

    const base = this.site.baseUrl
    return (results as ChartResult[])
      .filter((r) => r && typeof r.id === 'number')
      .map((r) => ({
        artistId: String(r.id),
        name: r.name && r.name.trim().length > 1 ? r.name.trim() : `Artist ${r.id}`,
        profileUrl: r.homepage ? `${base}/${r.homepage}` : `${base}/artist/${r.id}`
      }))
  }

  private async genreValues(page: Page): Promise<string[]> {
    const values = await page
      .evaluate(() => {
        const g = globalThis as unknown as {
          document: { querySelector: (s: string) => { options?: ArrayLike<{ value: string }> } | null }
        }
        const sel = g.document.querySelector('select[name="genre"]')
        if (!sel || !sel.options) return [] as string[]
        return Array.from(sel.options).map((o) => o.value)
      })
      .catch(() => [] as string[])
    return values.map((v) => v.replace(/^string:/, '')).filter((v) => v && v !== 'all')
  }
}
