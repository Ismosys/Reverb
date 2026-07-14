import type { Page } from 'playwright'
import type { SiteSelectors, TrendingLocation } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { sleep } from '../utils/async'

/** A lightweight artist descriptor from the charts API. */
export interface DiscoveredArtist {
  /** Numeric ReverbNation artist id. */
  artistId: string
  name: string
  /** Canonical profile URL (vanity slug, or `/artist/<id>` fallback). */
  profileUrl: string
}

/** One row from `/api/charts/*`. */
interface ChartResult {
  id: number
  name?: string
  homepage?: string
}

/**
 * Discovers trending artists via ReverbNation's JSON charts API — far more
 * robust than scraping the AngularJS DOM.
 *
 * - **Global** location → `/api/charts/global?page=N&genre=G`
 * - **Custom** location → `/api/charts/local?location[latitude]=..&location[longitude]=..&page=N&genre=G`
 *
 * Each page returns ~10 artists (id, name, vanity slug). We paginate, then
 * iterate genres, accumulating distinct artists until the target is met or the
 * source is exhausted. All requests run in the authenticated page context.
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

  async scan(
    page: Page,
    opts: { target: number; location: TrendingLocation | null; signal?: AbortSignal }
  ): Promise<DiscoveredArtist[]> {
    const found = new Map<string, DiscoveredArtist>()
    const genres = ['', ...(await this.genreValues(page))] // '' = All Genres
    const scope = opts.location?.type === 'custom' ? `local (${opts.location.label})` : 'global'
    this.log.info('scan', `Charts API scan: target ${opts.target}, scope ${scope}, ${genres.length} genre bucket(s)`)

    for (const genre of genres) {
      if (found.size >= opts.target || opts.signal?.aborted) break
      for (let pageNum = 1; pageNum <= TrendingScanner.MAX_PAGES_PER_GENRE; pageNum++) {
        if (found.size >= opts.target || opts.signal?.aborted) break
        const artists = await this.fetchPage(page, opts.location, genre, pageNum)
        if (artists.length === 0) break
        let added = 0
        for (const a of artists) {
          if (!found.has(a.artistId)) {
            found.set(a.artistId, a)
            added++
          }
        }
        // No new artists on a later page → this bucket is exhausted.
        if (added === 0 && pageNum > 1) break
        await sleep(150, opts.signal)
      }
      if (genre) this.log.info('scan', `After genre "${genre}": ${found.size}/${opts.target}`)
    }

    const result = Array.from(found.values()).slice(0, opts.target)
    this.log.info('scan', `Scan complete: ${result.length} artist(s)`, {
      status: result.length >= opts.target ? 'ok' : 'partial'
    })
    return result
  }

  /** Fetch one chart page and map it to artists. Returns [] on any error. */
  private async fetchPage(
    page: Page,
    location: TrendingLocation | null,
    genre: string,
    pageNum: number
  ): Promise<DiscoveredArtist[]> {
    const params = [`page=${pageNum}`]
    if (genre) params.push(`genre=${encodeURIComponent(genre)}`)

    let path: string
    if (location?.type === 'custom' && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
      path =
        `/api/charts/local?location[latitude]=${location.latitude}` +
        `&location[longitude]=${location.longitude}&${params.join('&')}`
    } else {
      path = `/api/charts/global?${params.join('&')}`
    }

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

  /** Read genre values from the charts DOM (stripping the AngularJS prefix). */
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
    return values
      .map((v) => v.replace(/^string:/, ''))
      .filter((v) => v && v !== 'all')
  }
}
