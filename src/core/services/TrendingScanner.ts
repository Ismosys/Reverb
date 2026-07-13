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

  /** Site routes that are single-segment but are NOT artist profiles. */
  private static readonly NON_ARTIST_SLUGS = new Set([
    'main', 'control_room', 'signup', 'login', 'logout', 'pricing', 'features',
    'fan-promotion', 'termsandconditions', 'copyright', 'privacy', 'about',
    'help', 'blog', 'store', 'opportunities', 'distribution', 'contact', 'press',
    'connect', 'marketplace', 'trademark', 'refund', 'abuse', 'band-promotion',
    'venue-promotion', 'industryprofessionals', 'artist-promotion', 'music-promotion',
    'fan-reach', 'api', 'jobs', 'advertising', 'sitemap', 'careers', 'mobile'
  ])

  /**
   * Extract distinct artist profiles from the charts page. Artist links use a
   * single-segment vanity slug (e.g. `/leelagrant`) and live in the chart
   * listing — NOT the header/nav/footer, which also contain single-segment
   * slugs (e.g. `/marketplace`). We therefore exclude page chrome and known
   * site routes. Names are best-effort here and resolved authoritatively from
   * each profile page during processing.
   */
  private async extract(page: Page): Promise<DiscoveredArtist[]> {
    const found = await page
      .evaluate((deny: string[]) => {
        const NON = new Set(deny)
        const isSlug = (href: string): boolean => {
          const m = href.split('?')[0].match(/^\/([a-z0-9][a-z0-9_-]{2,})$/i)
          return !!m && !NON.has(m[1].toLowerCase())
        }
        type Anchor = {
          getAttribute: (n: string) => string | null
          closest: (s: string) => unknown
          textContent: string | null
        }
        const doc = (globalThis as unknown as {
          document: { querySelectorAll: (s: string) => ArrayLike<Anchor> }
        }).document
        const anchors = Array.from(doc.querySelectorAll('a[href^="/"]'))
        const out: Array<{ href: string; text: string }> = []
        const seen = new Set<string>()
        for (const a of anchors) {
          if (a.closest('header, nav, footer')) continue
          const href = a.getAttribute('href') || ''
          if (!isSlug(href)) continue
          const path = href.split('?')[0]
          if (seen.has(path)) continue
          seen.add(path)
          out.push({ href: path, text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) })
        }
        return out
      }, Array.from(TrendingScanner.NON_ARTIST_SLUGS))
      .catch(() => [] as Array<{ href: string; text: string }>)

    const out = new Map<string, DiscoveredArtist>()
    for (const { href, text } of found) {
      const profileUrl = `${this.site.baseUrl}${href}`
      if (!isHttpUrl(profileUrl)) continue
      const id = artistIdFromUrl(profileUrl)
      const name = this.plausibleName(text) ? text : this.slugToName(href)
      if (!out.has(id)) out.set(id, { artistId: id, name, profileUrl })
    }
    return Array.from(out.values())
  }

  private plausibleName(text: string): boolean {
    if (text.length < 2 || text.length > 60) return false
    return !/^(view artist|yes|no|become a fan|remove fan|play|follow)$/i.test(text)
  }

  private slugToName(href: string): string {
    const slug = href.split('?')[0].replace(/^\//, '')
    return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
}
