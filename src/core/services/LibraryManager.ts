import type { Page } from 'playwright'
import type { SiteSelectors } from '@shared/types'
import type { Logger } from '../logging/Logger'
import type { HumanBehavior } from './HumanBehavior'
import { sleep } from '../utils/async'
import { AppError, RecoverableError } from '../utils/errors'

/** Reports fine-grained sub-steps so the dashboard can show live status. */
export type StatusReporter = (message: string) => void

export type SaveOutcome = 'saved' | 'skipped'

export interface SaveResult {
  outcome: SaveOutcome
  updatesEnabled: boolean
}

export interface SaveOptions {
  receiveUpdates: boolean
  onStatus?: StatusReporter
  signal?: AbortSignal
  /** Waits scale from this (ms); intelligent waits are used where possible. */
  actionTimeoutMs?: number
}

/**
 * Performs the exact "Add to Library" interaction seen in the reference
 * recording, human-paced and waiting for each confirmation before proceeding:
 *
 *   three-dot row menu → "Add to Library" (Save) → wait for the confirmation
 *   toast → "Receive Updates?" dialog → click "Yes" → wait for it to dismiss.
 *
 * Selectors use stable ReverbNation data-attributes:
 *   - menu trigger:  a[data-dropdown="charts_artist_<id>"]
 *   - dropdown:      #charts_artist_<id>
 *   - add:           a[data-fan-action="add"]  (hidden when already a fan)
 *   - already-fan:   a[data-fan-action="remove"] visible / "Remove from Library"
 *   - Yes/No:        a[href*="became_fan_save/artist_<id>"][receive_emails=1|0]
 */
export class LibraryManager {
  constructor(
    private readonly _site: SiteSelectors,
    private readonly human: HumanBehavior,
    private readonly log: Logger
  ) {
    void this._site
  }

  /**
   * Add the artist row (identified by `id`) to the library via its row menu.
   * Throws RecoverableError on transient UI failures so the caller can retry.
   */
  async addViaRowMenu(
    page: Page,
    artist: { id: string; name: string },
    opts: SaveOptions
  ): Promise<SaveResult> {
    const { id, name } = artist
    const timeout = opts.actionTimeoutMs ?? 12000
    const status = opts.onStatus ?? (() => undefined)
    this.throwIfAborted(opts.signal)

    // 1. Open the three-dot overflow menu.
    status('Opening menu…')
    const trigger = page.locator(`a[data-dropdown="charts_artist_${id}"]`).first()
    if ((await trigger.count()) === 0) throw new RecoverableError(`Row menu not found for ${name}`)
    await trigger.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined)
    await this.human.aroundClick(opts.signal)
    await trigger.click({ timeout })

    // 2. Wait for the popup menu to fully appear (intelligent wait).
    const dropdown = page.locator(`#charts_artist_${id}`).first()
    const opened = await dropdown
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)
    if (!opened) throw new RecoverableError(`Menu did not open for ${name}`)

    // 3. Already saved? "Add" is hidden and "Remove from Library" is shown.
    const addOption = page.locator(`#charts_artist_${id} a[data-fan-action="add"]`).first()
    const addVisible = await addOption.isVisible().catch(() => false)
    if (!addVisible) {
      status('Already in library')
      this.log.info('library', `Skip (already in library): ${name}`, { artist: name, status: 'skipped' })
      await this.dismissMenu(page, opts.signal)
      return { outcome: 'skipped', updatesEnabled: true }
    }

    // 4. Click "Add to Library".
    status('Adding to library…')
    await this.human.aroundClick(opts.signal)
    await addOption.click({ timeout })

    // 5. Wait for the success confirmation toast in the corner.
    status('Waiting for confirmation…')
    const confirmed = await this.waitForToast(page, name, timeout)
    if (!confirmed) throw new RecoverableError(`No "added to library" confirmation for ${name}`)

    // 6/7. Accept the "Receive Updates?" dialog, then wait for it to close.
    const updatesEnabled = await this.answerReceiveUpdates(page, id, name, opts, status, timeout)

    // 8. Close any lingering menu.
    await this.dismissMenu(page, opts.signal)
    status('Completed')
    this.log.info('library', `Added to library: ${name}${updatesEnabled ? ' (updates on)' : ''}`, { artist: name })
    return { outcome: 'saved', updatesEnabled }
  }

  /**
   * Add an artist by visiting their profile and using the "Become a Fan" →
   * "Receive Updates? Yes" flow. Used for custom-location artists, which are not
   * rendered as rows on the community list.
   */
  async addViaProfile(
    page: Page,
    artist: { id: string; name: string; profileUrl: string },
    opts: SaveOptions
  ): Promise<SaveResult> {
    const { name, profileUrl } = artist
    const timeout = opts.actionTimeoutMs ?? 12000
    const status = opts.onStatus ?? (() => undefined)
    this.throwIfAborted(opts.signal)

    status('Opening profile…')
    if (!page.url().startsWith(profileUrl)) {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
    }

    // Already a fan?
    if (await page.locator('a.button--added--profile').first().isVisible().catch(() => false)) {
      status('Already in library')
      this.log.info('library', `Skip (already in library): ${name}`, { artist: name, status: 'skipped' })
      return { outcome: 'skipped', updatesEnabled: true }
    }

    status('Adding to library…')
    const become = page.locator('a.button--add--profile').first()
    if (!(await become.isVisible().catch(() => false))) {
      throw new RecoverableError(`"Become a Fan" not found for ${name}`)
    }
    await this.human.aroundClick(opts.signal)
    await become.click({ timeout })

    status('Waiting for confirmation…')
    const want = opts.receiveUpdates
    const choice = page.locator(`a.js-fan-action:has-text("${want ? 'Yes' : 'No'}")`).first()
    const appeared = await choice
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)

    let updatesEnabled = false
    if (appeared) {
      status(want ? 'Accepting updates…' : 'Declining updates…')
      await this.human.aroundClick(opts.signal)
      await choice.click({ timeout }).catch(() => undefined)
      updatesEnabled = want
    }

    // Verify: "Remove Fan" now present.
    const ok = await page
      .locator('a.button--added--profile')
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)
    if (!ok) throw new RecoverableError(`Fan action not confirmed for ${name}`)

    status('Completed')
    this.log.info('library', `Added to library: ${name}${updatesEnabled ? ' (updates on)' : ''}`, { artist: name })
    return { outcome: 'saved', updatesEnabled }
  }

  /**
   * Turbo path: the same two server actions the menu performs, without the UI —
   *   1. `become_fan`      → adds the artist to the library (the real "Save").
   *   2. `became_fan_save` → sets receive-updates (the "Yes" answer).
   * Both are authenticated POSTs from the current page (CSRF token from <meta>).
   * Step 1 is verified via its response signal; a failure is retryable.
   */
  async addViaRequest(
    page: Page,
    artist: { id: string; name: string },
    opts: SaveOptions
  ): Promise<SaveResult> {
    const { id, name } = artist
    const status = opts.onStatus ?? (() => undefined)
    this.throwIfAborted(opts.signal)

    // Step 1 — Add to Library (become a fan). THIS is the actual save.
    status('Adding to library…')
    const fan = await this.postFan(page, `/artist/become_fan/${id}?without_modal=true`)
    if (fan.status === 0 || fan.status >= 500) {
      throw new RecoverableError(`Save failed for ${name} (status ${fan.status})`)
    }
    const fanned = fan.ok && /became_fan|already[_\s-]?fan|success/i.test(fan.text)
    if (!fanned) {
      throw new RecoverableError(`Save not confirmed for ${name} (status ${fan.status}: ${fan.text.slice(0, 40)})`)
    }

    // Step 2 — Receive updates? Yes (best-effort; the save already succeeded).
    let updatesEnabled = false
    if (opts.receiveUpdates) {
      status('Accepting updates…')
      const upd = await this.postFan(
        page,
        `/artist/became_fan_save/artist_${id}?become_a_fan=1&receive_emails=1&without_modal=true`
      )
      updatesEnabled = upd.ok || /modal_close|success/i.test(upd.text)
      if (!updatesEnabled) this.log.warn('library', `Updates not confirmed for ${name}`, { artist: name })
    }

    status('Completed')
    this.log.info('library', `Added to library: ${name}${updatesEnabled ? ' (updates on)' : ''}`, { artist: name })
    return { outcome: 'saved', updatesEnabled }
  }

  /** POST an authenticated fan action from the page context (with CSRF token). */
  private async postFan(page: Page, url: string): Promise<{ status: number; ok: boolean; text: string }> {
    return page.evaluate(async (u: string) => {
      const g = globalThis as unknown as {
        document: { querySelector: (s: string) => { getAttribute: (n: string) => string | null } | null }
        fetch: (u: string, o: unknown) => Promise<{ status: number; ok: boolean; text: () => Promise<string> }>
        URLSearchParams: new (init: Record<string, string>) => unknown
      }
      const token = g.document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
      try {
        const r = await g.fetch(u, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'X-CSRF-Token': token,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new g.URLSearchParams({ authenticity_token: token })
        })
        return { status: r.status, ok: r.ok, text: (await r.text()).slice(0, 160) }
      } catch (e) {
        return { status: 0, ok: false, text: String(e) }
      }
    }, url)
  }

  /** Wait for the "<name> has been added to your Library" toast. */
  private async waitForToast(page: Page, name: string, timeout: number): Promise<boolean> {
    return page
      .waitForFunction(
        () => {
          const g = globalThis as unknown as { document: { body: { innerText: string } } }
          return /added to your library|added to library/i.test(g.document.body.innerText)
        },
        undefined,
        { timeout, polling: 250 }
      )
      .then(() => true)
      .catch(() => false)
      .then((ok) => {
        if (ok) this.log.debug('library', `Confirmation toast detected for ${name}`)
        return ok
      })
  }

  /**
   * Answer the "Receive Updates?" prompt (Yes when receiveUpdates, else No),
   * then wait for the dialog to disappear. Returns whether updates were enabled.
   */
  private async answerReceiveUpdates(
    page: Page,
    id: string,
    name: string,
    opts: SaveOptions,
    status: StatusReporter,
    timeout: number
  ): Promise<boolean> {
    const want = opts.receiveUpdates
    const emails = want ? 1 : 0
    status(want ? 'Accepting updates…' : 'Declining updates…')
    const choice = page.locator(`a[href*="became_fan_save/artist_${id}"][href*="receive_emails=${emails}"]`).first()

    const appeared = await choice
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false)
    if (!appeared) {
      // Some rows auto-complete without an explicit prompt; not fatal.
      this.log.warn('library', `Receive-updates prompt did not appear for ${name}`, { artist: name })
      return false
    }

    await this.human.aroundClick(opts.signal)
    await choice.click({ timeout }).catch(() => undefined)

    // Wait until the prompt is gone (intelligent wait, not a fixed sleep).
    await page
      .waitForFunction(
        () => {
          const g = globalThis as unknown as { document: { body: { innerText: string } } }
          return !/receive updates\?/i.test(g.document.body.innerText)
        },
        undefined,
        { timeout, polling: 250 }
      )
      .catch(() => undefined)
    return want
  }

  /** Close any open row dropdown/menu (Escape; avoids navigating the page). */
  private async dismissMenu(page: Page, signal?: AbortSignal): Promise<void> {
    await page.keyboard.press('Escape').catch(() => undefined)
    await sleep(150, signal).catch(() => undefined)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AppError('Aborted', { code: 'ABORTED' })
  }
}
