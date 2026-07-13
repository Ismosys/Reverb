import { ConfigManager } from './config/ConfigManager'
import { Logger } from './logging/Logger'
import { Database } from './db/Database'
import { BrowserManager } from './browser/BrowserManager'
import { AuthService } from './services/AuthService'
import { NavigationService } from './services/NavigationService'
import { LocationManager } from './services/LocationManager'
import { TrendingScanner } from './services/TrendingScanner'
import { LibraryManager } from './services/LibraryManager'
import { ArtistProcessor } from './services/ArtistProcessor'
import { HumanBehavior } from './services/HumanBehavior'
import { HealthMonitor } from './health/HealthMonitor'
import { ReportService } from './reporting/ReportService'
import { AutomationEngine } from './engine/AutomationEngine'

/**
 * Composition root. Constructs every service and wires their dependencies in
 * one place (manual dependency injection). The main process holds a single
 * AppContainer for the app's lifetime.
 */
export class AppContainer {
  readonly config: ConfigManager
  readonly log: Logger
  readonly db: Database
  readonly browser: BrowserManager
  readonly auth: AuthService
  readonly nav: NavigationService
  readonly location: LocationManager
  readonly scanner: TrendingScanner
  readonly library: LibraryManager
  readonly health: HealthMonitor
  readonly report: ReportService
  readonly engine: AutomationEngine

  constructor(userDataDir: string) {
    this.config = ConfigManager.load(userDataDir)
    const cfg = this.config.get()

    this.log = new Logger(cfg.paths.logsPath)
    this.db = new Database(cfg.paths.databasePath)
    this.browser = new BrowserManager(this.log)

    const human = new HumanBehavior(cfg.automation)
    this.auth = new AuthService(this.browser, cfg.site, this.log)
    this.nav = new NavigationService(this.browser, cfg.site, this.log)
    this.location = new LocationManager(cfg.site, this.log)
    this.scanner = new TrendingScanner(cfg.site, human, this.log)
    this.library = new LibraryManager(cfg.site, human, this.log)
    this.report = new ReportService(this.db, cfg.paths.reportsPath, this.log)
    this.health = new HealthMonitor(this.browser, this.db)

    // The processor reads live config each run, so it is built lazily.
    const processorFactory = (): ArtistProcessor => {
      const current = this.config.get()
      return new ArtistProcessor(
        this.browser,
        this.db,
        this.library,
        new HumanBehavior(current.automation),
        current.automation,
        this.log
      )
    }

    this.engine = new AutomationEngine({
      config: this.config,
      db: this.db,
      log: this.log,
      browser: this.browser,
      auth: this.auth,
      nav: this.nav,
      location: this.location,
      scanner: this.scanner,
      processorFactory,
      health: this.health,
      report: this.report
    })

    this.health.start()
  }

  async dispose(): Promise<void> {
    this.health.stop()
    try {
      this.engine.stop()
    } catch {
      /* ignore */
    }
    await this.browser.close()
    this.db.close()
    await this.log.close()
  }
}
