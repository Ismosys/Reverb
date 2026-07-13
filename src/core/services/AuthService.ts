import type { Page } from 'playwright'
import type { AuthStatus, SiteSelectors } from '@shared/types'
import type { BrowserManager } from '../browser/BrowserManager'
import type { Logger } from '../logging/Logger'
import { AuthenticationError } from '../utils/errors'
import { withTimeout } from '../utils/async'

/**
 * Handles authentication against a persistent browser profile.
 *
 * The strategy is "log in once, reuse forever": we never store credentials.
 * Instead, `openLoginWindow` opens a real (headful) browser at the login page
 * and lets the human complete login; the persistent profile keeps the session.
 * `checkAuthenticated` then verifies the session on every run and detects
 * expiry so the UI can prompt for a fresh login only when actually needed.
 */
export class AuthService {
  constructor(
    private readonly browser: BrowserManager,
    private readonly site: SiteSelectors,
    private readonly log: Logger
  ) {}

  /** Verify whether the current persistent session is authenticated. */
  async checkAuthenticated(): Promise<AuthStatus> {
    if (!this.browser.isReady()) return 'unknown'
    try {
      const page = await this.browser.getPage()
      await this.gotoHome(page)
      const indicator = page.locator(this.site.loggedInIndicator).first()
      const visible = await indicator
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false)

      if (visible) {
        this.log.info('auth', 'Session is authenticated')
        return 'authenticated'
      }

      // No logged-in indicator: if the "Log In" affordance is present we are
      // definitively logged out; otherwise treat as an expired/unknown session.
      const loggedOut = await page
        .locator(this.site.loggedOutIndicator)
        .first()
        .isVisible()
        .catch(() => false)
      const status: AuthStatus = loggedOut ? 'unauthenticated' : 'expired'
      this.log.warn('auth', `Session not authenticated (${status})`, { status })
      return status
    } catch (err) {
      this.log.error('auth', 'Auth check failed', { error: err instanceof Error ? err.message : String(err) })
      return 'unknown'
    }
  }

  /**
   * Open the login page for interactive sign-in and wait (up to `timeoutMs`)
   * for the logged-in indicator to appear. Resolves once authenticated.
   */
  async openLoginWindow(timeoutMs = 5 * 60 * 1000): Promise<AuthStatus> {
    const page = await this.browser.getPage()
    await page.goto(`${this.site.baseUrl}${this.site.loginPath}`, { waitUntil: 'domcontentloaded' })
    this.log.info('auth', 'Login window opened; waiting for user to sign in')

    try {
      await withTimeout(
        page.locator(this.site.loggedInIndicator).first().waitFor({ state: 'visible', timeout: timeoutMs }),
        timeoutMs,
        'login'
      )
      this.log.info('auth', 'Login successful; session persisted')
      return 'authenticated'
    } catch (err) {
      throw new AuthenticationError('Login was not completed in time', err)
    }
  }

  /** Ensure the session is authenticated or throw (used before a run). */
  async requireAuthenticated(): Promise<void> {
    const status = await this.checkAuthenticated()
    if (status !== 'authenticated') {
      throw new AuthenticationError(`Authentication required (status: ${status})`)
    }
  }

  private async gotoHome(page: Page): Promise<void> {
    if (!page.url().startsWith(this.site.baseUrl)) {
      await page.goto(this.site.baseUrl, { waitUntil: 'domcontentloaded' })
    }
    // Allow the AngularJS header to hydrate before we read auth state.
    await page.waitForTimeout(1500)
  }
}
