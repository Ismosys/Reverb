import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import { RecoverableError } from '../utils/errors'

export interface SaveResult {
  saved: boolean
  updatesEnabled: boolean
  alreadySaved: boolean
}

/**
 * Saves an artist to the user's library ("Become a Fan") and sets update
 * notifications, in a single call.
 *
 * ReverbNation fans an artist via a form POST to
 * `/artist/became_fan_save/artist_<id>?become_a_fan=1&receive_emails=<0|1>`
 * carrying the page CSRF token. Issuing this POST from the authenticated page
 * context (verified to return `modal_close();` and to persist) lets us fan at
 * scale without navigating to each profile — thousands of artists per run.
 */
export class LibraryManager {
  constructor(
    private readonly _site: SiteSelectors,
    private readonly log: Logger
  ) {
    void this._site
  }

  /**
   * Fan `artist` from the current authenticated page context. `page` must be on
   * a reverbnation.com page (the charts page after scanning) so the POST is
   * same-origin and a CSRF token is available.
   */
  async save(
    page: Page,
    artist: { artistId: string; name: string },
    receiveUpdates: boolean
  ): Promise<SaveResult> {
    const receive = receiveUpdates ? 1 : 0
    const res = await page.evaluate(
      async ({ id, receive }) => {
        const g = globalThis as unknown as {
          document: { querySelector: (s: string) => { getAttribute: (n: string) => string | null } | null }
          fetch: (u: string, o: unknown) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>
          URLSearchParams: new (init: Record<string, string>) => unknown
        }
        const token = g.document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        const url = `/artist/became_fan_save/artist_${id}?become_a_fan=1&receive_emails=${receive}&without_modal=true`
        try {
          const r = await g.fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'X-CSRF-Token': token,
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new g.URLSearchParams({ authenticity_token: token })
          })
          const text = (await r.text()).slice(0, 120)
          return { status: r.status, ok: r.ok, text }
        } catch (e) {
          return { status: 0, ok: false, text: String(e) }
        }
      },
      { id: artist.artistId, receive }
    )

    // Network/server errors are retryable; a clear rejection is not.
    if (res.status === 0 || res.status >= 500) {
      throw new RecoverableError(`Fan POST failed for ${artist.name} (status ${res.status})`)
    }
    const success = res.ok || /modal_close|success|already/i.test(res.text)
    if (!success) {
      throw new RecoverableError(`Fan not confirmed for ${artist.name} (status ${res.status}: ${res.text})`)
    }

    this.log.info('save', `Fanned: ${artist.name}${receiveUpdates ? ' (updates on)' : ''}`, { artist: artist.name })
    return { saved: true, updatesEnabled: receiveUpdates, alreadySaved: false }
  }
}
