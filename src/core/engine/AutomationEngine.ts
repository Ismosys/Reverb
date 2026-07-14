import type {
  AuthStatus,
  AutomationSettings,
  BrowserStatus,
  EngineState,
  RunStatus,
  TrendingLocation
} from '@shared/types'
import type { ConfigManager } from '../config/ConfigManager'
import type { Database } from '../db/Database'
import type { Logger } from '../logging/Logger'
import type { BrowserManager } from '../browser/BrowserManager'
import type { AuthService } from '../services/AuthService'
import type { NavigationService } from '../services/NavigationService'
import type { TrendingScanner } from '../services/TrendingScanner'
import type { ArtistProcessor } from '../services/ArtistProcessor'
import type { HealthMonitor } from '../health/HealthMonitor'
import type { ReportService } from '../reporting/ReportService'
import { TypedEmitter } from '../utils/events'
import { sleep } from '../utils/async'
import { splitEvenly } from '../utils/numbers'
import { AppError, AuthenticationError, toMessage } from '../utils/errors'

export interface EngineDeps {
  config: ConfigManager
  db: Database
  log: Logger
  browser: BrowserManager
  auth: AuthService
  nav: NavigationService
  scanner: TrendingScanner
  processorFactory: () => ArtistProcessor
  health: HealthMonitor
  report: ReportService
}

type EngineEvents = { status: RunStatus }

let sessionCounter = 0

/**
 * The orchestrator. Owns the run lifecycle (start/pause/resume/stop), drives the
 * services through the automation workflow, tracks live statistics and emits a
 * `status` snapshot the UI subscribes to.
 *
 * Pause/resume is cooperative: long loops await `waitWhilePaused()` at safe
 * checkpoints. Stop is an AbortController the whole pipeline observes.
 */
export class AutomationEngine extends TypedEmitter<EngineEvents> {
  private state: EngineState = 'idle'
  private authStatus: AuthStatus = 'unknown'
  private abort: AbortController | null = null
  private paused = false
  private startedAt: number | null = null
  private currentLocation: TrendingLocation | null = null
  private runLocations: TrendingLocation[] = []
  private runLabel: string | null = null
  private currentArtist: string | null = null
  private currentOperation: string | null = null
  private consecutiveFailures = 0

  // Run counters
  private target = 0
  private processed = 0
  private saved = 0
  private skipped = 0
  private failed = 0

  constructor(private readonly deps: EngineDeps) {
    super()
    // Recover from an unexpected browser crash mid-run.
    deps.browser.on('crashed', () => {
      if (this.isRunning()) {
        this.deps.log.error('engine', 'Browser crashed during run; attempting recovery')
      }
    })
  }

  isRunning(): boolean {
    return ['starting', 'authenticating', 'navigating', 'scanning', 'processing'].includes(this.state)
  }

  getStatus(): RunStatus {
    const elapsedMs = this.startedAt ? Date.now() - this.startedAt : 0
    const speedPerMin = elapsedMs > 0 ? (this.processed / (elapsedMs / 60000)) : 0
    const remaining = Math.max(0, this.target - this.saved)
    const etaMs = speedPerMin > 0 && remaining > 0 ? (remaining / speedPerMin) * 60000 : null
    return {
      engineState: this.state,
      authStatus: this.authStatus,
      browserStatus: this.deps.browser.status as BrowserStatus,
      activeLocationLabel: this.currentLocation?.label ?? this.deps.config.getActiveLocation()?.label ?? null,
      targetCount: this.target,
      processed: this.processed,
      remaining,
      saved: this.saved,
      skipped: this.skipped,
      failed: this.failed,
      currentArtist: this.currentArtist,
      currentOperation: this.currentOperation,
      progress: this.target > 0 ? Math.min(1, this.saved / this.target) : 0,
      elapsedMs,
      etaMs,
      speedPerMin: Math.round(speedPerMin * 10) / 10,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null
    }
  }

  private setState(state: EngineState): void {
    this.state = state
    this.deps.health.setEngineState(state)
    this.push()
  }

  private setOperation(op: string | null): void {
    this.currentOperation = op
    this.push()
  }

  private push(): void {
    this.emit('status', this.getStatus())
  }

  /* --------------------------- Controls ---------------------------- */

  pause(): void {
    if (!this.isRunning()) return
    this.paused = true
    this.setState('paused')
    this.deps.log.info('engine', 'Run paused')
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.setState('processing')
    this.deps.log.info('engine', 'Run resumed')
  }

  stop(): void {
    if (!this.abort) return
    this.setState('stopping')
    this.deps.log.info('engine', 'Stop requested')
    this.abort.abort()
    this.paused = false
  }

  private get signal(): AbortSignal {
    if (!this.abort) this.abort = new AbortController()
    return this.abort.signal
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.signal.aborted) {
      await sleep(300).catch(() => undefined)
    }
  }

  /* ----------------------------- Run ------------------------------- */

  /**
   * Execute a full automation run. Safe to call once; concurrent starts are
   * rejected. Returns the final status snapshot.
   */
  async start(): Promise<RunStatus> {
    if (this.isRunning()) throw new AppError('A run is already in progress', { code: 'BUSY' })

    this.resetCounters()
    this.abort = new AbortController()
    this.startedAt = Date.now()
    const cfg = this.deps.config.get()
    const settings = cfg.automation
    // Resolve the ordered locations this run visits. `artistsToSave` is the
    // TOTAL target for the run, split as evenly as possible across the visited
    // locations (front-loading any remainder). A single-location run gets it all.
    this.runLocations = this.deps.config.resolveRunLocations()
    this.target = settings.artistsToSave
    const passes = Math.max(1, this.runLocations.length)
    this.currentLocation = this.runLocations[0] ?? null
    this.runLabel = this.runLocations.length ? this.runLocations.map((l) => l.label).join(' → ') : null
    const runLabel = this.runLabel ?? 'default'
    const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${++sessionCounter}`

    this.setState('starting')
    this.deps.log.info(
      'engine',
      `Run started (target=${this.target}${settings.cycleLocations ? ` split across ${passes} location(s)` : ''}, location=${runLabel})`
    )
    this.deps.db.createSession(sessionId, runLabel, this.target)

    // Optional hard time budget.
    let timeBudget: NodeJS.Timeout | null = null
    if (settings.maxExecutionTimeMs > 0) {
      timeBudget = setTimeout(() => {
        this.deps.log.warn('engine', 'Maximum execution time reached; stopping')
        this.stop()
      }, settings.maxExecutionTimeMs)
      timeBudget.unref?.()
    }

    try {
      await this.runWorkflow()
      if (this.signal.aborted) {
        this.setState('idle')
        this.deps.log.info('engine', 'Run stopped by user')
      } else {
        this.setState('completed')
        this.deps.log.info('engine', `Run completed: saved=${this.saved}, failed=${this.failed}, skipped=${this.skipped}`)
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        this.authStatus = 'expired'
        this.setState('error')
        this.deps.log.error('engine', `Authentication required: ${toMessage(err)}`, { status: 'auth' })
      } else {
        this.setState('error')
        this.deps.log.error('engine', `Run failed: ${toMessage(err)}`, { error: toMessage(err) })
      }
    } finally {
      if (timeBudget) clearTimeout(timeBudget)
      this.finalize(sessionId)
    }

    return this.getStatus()
  }

  /** The ordered automation workflow. Runs one pass per resolved location. */
  private async runWorkflow(): Promise<void> {
    const cfg = this.deps.config.get()
    const settings = cfg.automation

    // 1. Launch browser with the persistent profile.
    this.setState('starting')
    this.setOperation('Launching browser')
    await this.deps.browser.launch({
      profilePath: cfg.paths.browserProfilePath,
      headless: settings.headless
    })

    // 2. Verify authentication (once for the whole run).
    this.setState('authenticating')
    this.setOperation('Verifying authentication')
    this.authStatus = await this.deps.auth.checkAuthenticated()
    this.push()
    if (this.authStatus !== 'authenticated') {
      throw new AuthenticationError(`Session is ${this.authStatus}. Please log in.`)
    }

    // 3. One pass per location (single-location runs use `[location]` or `[null]`).
    //    The total target is split across passes; the remainder is front-loaded.
    const passes = this.runLocations.length ? this.runLocations : [null]
    const passTargets = splitEvenly(this.target, passes.length)
    for (let i = 0; i < passes.length; i++) {
      const passTarget = passTargets[i]
      if (this.signal.aborted || this.saved >= this.target || passTarget <= 0) break
      if (settings.stopAfterFailures > 0 && this.consecutiveFailures >= settings.stopAfterFailures) break
      this.currentLocation = passes[i]
      const suffix = passes.length > 1 ? ` (${i + 1}/${passes.length}, target ${passTarget})` : ''
      this.deps.log.info('engine', `Location pass${suffix}: ${this.currentLocation?.label ?? 'default'}`)
      await this.runLocationPass(this.currentLocation, settings, passTarget)
    }

    this.currentArtist = null
    this.setOperation(null)
  }

  /** Scan and process a single location up to `passTarget` fresh saves. */
  private async runLocationPass(
    location: TrendingLocation | null,
    settings: AutomationSettings,
    passTarget: number
  ): Promise<void> {
    // Navigate to the Charts page to establish the authenticated session/CSRF
    // context the charts API and fan POST run within.
    this.setState('navigating')
    this.setOperation('Opening Charts')
    const page = await this.deps.nav.gotoTrending({ retries: settings.maxRetries, signal: this.signal })

    // Discover artists for this location via the charts API.
    this.setState('scanning')
    this.setOperation(`Scanning charts: ${location?.label ?? 'Global'}`)
    const discovered = await this.deps.scanner.scan(page, {
      target: passTarget,
      location,
      signal: this.signal
    })
    this.deps.log.info('engine', `Discovered ${discovered.length} artist(s) at ${location?.label ?? 'Global'}`)

    // Process artists until this pass's target is reached or the list is exhausted.
    this.setState('processing')
    const processor = this.deps.processorFactory()
    const locationLabel = location?.label ?? null
    let savedThisPass = 0

    for (const artist of discovered) {
      if (this.signal.aborted) break
      await this.waitWhilePaused()
      if (this.signal.aborted) break

      if (savedThisPass >= passTarget || this.saved >= this.target) {
        this.deps.log.info('engine', 'Location target reached; moving on')
        break
      }
      if (settings.stopAfterFailures > 0 && this.consecutiveFailures >= settings.stopAfterFailures) {
        this.deps.log.error('engine', `Stopping after ${this.consecutiveFailures} consecutive failures`)
        break
      }

      this.currentArtist = artist.name
      this.setOperation(`Processing ${artist.name}`)

      const result = await processor.process(artist, locationLabel, this.signal)
      this.processed++
      switch (result.outcome) {
        case 'saved':
          this.saved++
          savedThisPass++
          this.consecutiveFailures = 0
          break
        case 'skipped':
          this.skipped++
          break
        case 'failed':
          this.failed++
          this.consecutiveFailures++
          break
      }
      this.emitArtist(result.record.artistId)
      this.push()
    }
  }

  private artistListeners = new Set<(artistId: string) => void>()
  onArtistUpdated(cb: (artistId: string) => void): () => void {
    this.artistListeners.add(cb)
    return () => this.artistListeners.delete(cb)
  }
  private emitArtist(artistId: string): void {
    for (const cb of this.artistListeners) cb(artistId)
  }

  private finalize(sessionId: string): void {
    this.deps.db.finalizeSession(sessionId, {
      processed: this.processed,
      saved: this.saved,
      failed: this.failed,
      skipped: this.skipped
    })

    const settings = this.deps.config.get().automation
    if (settings.exportReportOnFinish) {
      try {
        const endTime = new Date().toISOString()
        const startTime = this.startedAt ? new Date(this.startedAt).toISOString() : endTime
        const report = this.deps.report.buildSessionReport({
          sessionId,
          startTime,
          endTime,
          locationLabel: this.runLabel ?? this.currentLocation?.label ?? null
        })
        this.deps.report.writeSessionReport(report)
        this.deps.report.export(settings.reportFormat, undefined, `session-${sessionId}`)
      } catch (err) {
        this.deps.log.error('report', `Failed to auto-export report: ${toMessage(err)}`)
      }
    }
    this.push()
  }

  private resetCounters(): void {
    this.processed = 0
    this.saved = 0
    this.skipped = 0
    this.failed = 0
    this.consecutiveFailures = 0
    this.currentArtist = null
    this.currentOperation = null
    this.paused = false
  }
}
