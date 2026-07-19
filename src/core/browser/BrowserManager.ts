import { mkdirSync } from 'node:fs'
import { chromium, type BrowserContext, type Page } from 'playwright'
import type { BrowserStatus } from '@shared/types'
import type { Logger } from '../logging/Logger'
import { BrowserCrashError } from '../utils/errors'
import { TypedEmitter } from '../utils/events'

export interface BrowserOptions {
  profilePath: string
  headless: boolean
  /** Applied as the context default navigation/action timeout. */
  defaultTimeoutMs?: number
}

type BrowserEvents = { statusChanged: BrowserStatus; crashed: void }

/**
 * Owns the Playwright persistent browser context.
 *
 * A *persistent* context (launchPersistentContext) is the key to "log in once":
 * cookies, localStorage and the whole profile live on disk at `profilePath`, so
 * sessions survive app restarts without re-authenticating.
 */
export class BrowserManager extends TypedEmitter<BrowserEvents> {
  private context: BrowserContext | null = null
  private _status: BrowserStatus = 'closed'
  /** Headless mode of the currently-running context (null when closed). */
  private currentHeadless: boolean | null = null
  /** Profile dir of the currently-running context (for rotation reuse). */
  private _currentProfilePath: string | null = null
  private readonly log: Logger

  constructor(log: Logger) {
    super()
    this.log = log
  }

  get status(): BrowserStatus {
    return this._status
  }

  private setStatus(status: BrowserStatus): void {
    this._status = status
    this.emit('statusChanged', status)
  }

  isReady(): boolean {
    return this._status === 'ready' && this.context !== null
  }

  /** Launch (or return the already-running) persistent context. */
  async launch(opts: BrowserOptions): Promise<BrowserContext> {
    if (this.context && this._status === 'ready') {
      // Reuse only when the visibility mode matches; otherwise relaunch so that,
      // e.g., clicking Login always yields a VISIBLE window even if a headless
      // context (from Test Connection or a headless run) is already open.
      if (this.currentHeadless === opts.headless) return this.context
      this.log.info('browser', `Relaunching browser (headless ${this.currentHeadless} → ${opts.headless})`)
      await this.close()
    }
    this.setStatus('launching')
    mkdirSync(opts.profilePath, { recursive: true })

    try {
      const context = await chromium.launchPersistentContext(opts.profilePath, {
        headless: opts.headless,
        viewport: { width: 1440, height: 900 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US',
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check']
      })
      context.setDefaultTimeout(opts.defaultTimeoutMs ?? 30000)
      context.setDefaultNavigationTimeout(opts.defaultTimeoutMs ?? 45000)

      // Reduce trivially-detectable automation surface.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      context.on('close', () => {
        if (this._status !== 'closed') {
          this.context = null
          this.setStatus('crashed')
          this.emit('crashed', undefined)
          this.log.error('browser', 'Browser context closed unexpectedly', { status: 'crashed' })
        }
      })

      this.context = context
      this.currentHeadless = opts.headless
      this._currentProfilePath = opts.profilePath
      this.setStatus('ready')
      this.log.info('browser', `Browser launched (headless=${opts.headless})`)
      return context
    } catch (err) {
      this.currentHeadless = null
      this.setStatus('crashed')
      throw new BrowserCrashError('Failed to launch browser', err)
    }
  }

  /**
   * Switch to a different account's persistent session in place: gracefully
   * close the current context (flushing cookies) and launch the new profile.
   * Reused during automatic profile rotation — no container rebuild.
   */
  async switchProfile(opts: BrowserOptions): Promise<BrowserContext> {
    if (this._currentProfilePath === opts.profilePath && this._status === 'ready' && this.context) {
      return this.context
    }
    this.log.info('browser', 'Switching account session')
    await this.close()
    return this.launch(opts)
  }

  /** Get an existing page or open a fresh one. */
  async getPage(): Promise<Page> {
    if (!this.context) throw new BrowserCrashError('Browser is not running')
    const existing = this.context.pages()[0]
    if (existing && !existing.isClosed()) return existing
    return this.context.newPage()
  }

  context_(): BrowserContext {
    if (!this.context) throw new BrowserCrashError('Browser is not running')
    return this.context
  }

  /** Capture a screenshot into `path` for diagnostics (best-effort). */
  async screenshot(path: string): Promise<void> {
    try {
      const page = await this.getPage()
      await page.screenshot({ path, fullPage: false })
    } catch {
      // Diagnostics are best-effort; never let them break a run.
    }
  }

  async close(): Promise<void> {
    const ctx = this.context
    this.context = null
    this.currentHeadless = null
    this._currentProfilePath = null
    this.setStatus('closed')
    if (ctx) {
      try {
        await ctx.close()
      } catch {
        // ignore
      }
    }
  }
}
