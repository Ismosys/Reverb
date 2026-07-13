import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { artistIdFromUrl, isHttpUrl } from '../utils/validation'

/** A lightweight artist descriptor scraped from the trending grid. */
export interface DiscoveredArtist {
  artistId: string
  name: string
  profileUrl: string
}

/**
 * Scrolls the trending grid and extracts artist descriptors. Deduplicates by
 * artistId and stops once `target` distinct artists have been discovered (or
 * the page runs out of new content).
 */
export class TrendingScanner {
  constructor(
    private readonly site: SiteSelectors,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {}

  /**
   * Discover up to `target` artists. Scrolling is bounded by `maxScrollPages`.
   */
  async scan(
    page: Page,
    opts: { target: number; maxScrollPages: number; signal?: AbortSignal }
  ): Promise<DiscoveredArtist[]> {
    const found = new Map<string, DiscoveredArtist>()

    const collect = async (): Promise<void> => {
      const batch = await this.extract(page)
      for (const a of batch) if (!found.has(a.artistId)) found.set(a.artistId, a)
    }

    await collect()
    this.log.info('scan', `Initial scan found ${found.size} artist(s)`)

    const steps = await this.human.scrollUntil(page, {
      maxSteps: opts.maxScrollPages,
      signal: opts.signal,
      isDone: async () => {
        await collect()
        return found.size >= opts.target
      }
    })

    await collect()
    const result = Array.from(found.values()).slice(0, opts.target)
    this.log.info('scan', `Scan complete: ${result.length} artist(s) after ${steps} scroll step(s)`, {
      status: result.length >= opts.target ? 'ok' : 'partial'
    })
    return result
  }

  /** Extract the currently-rendered artist cards from the DOM. */
  private async extract(page: Page): Promise<DiscoveredArtist[]> {
    const cards = page.locator(this.site.artistCard)
    const count = await cards.count().catch(() => 0)
    const out: DiscoveredArtist[] = []

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i)
      try {
        const link = card.locator(this.site.artistLink).first()
        const href = await link.getAttribute('href').catch(() => null)
        if (!href) continue
        const profileUrl = href.startsWith('http') ? href : `${this.site.baseUrl}${href}`
        if (!isHttpUrl(profileUrl)) continue

        const nameEl = card.locator(this.site.artistName).first()
        const name =
          (await nameEl.textContent().catch(() => null))?.trim() ||
          (await link.textContent().catch(() => null))?.trim() ||
          'Unknown Artist'

        out.push({ artistId: artistIdFromUrl(profileUrl), name, profileUrl })
      } catch {
        // Skip malformed cards; a single bad node must not abort the scan.
      }
    }
    return out
  }
}
