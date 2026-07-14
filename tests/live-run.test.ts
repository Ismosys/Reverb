import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '@core/config/ConfigManager'
import { Logger } from '@core/logging/Logger'
import { Database } from '@core/db/Database'
import { BrowserManager } from '@core/browser/BrowserManager'
import { AuthService } from '@core/services/AuthService'
import { NavigationService } from '@core/services/NavigationService'
import { TrendingScanner } from '@core/services/TrendingScanner'
import { LibraryManager } from '@core/services/LibraryManager'
import { ArtistProcessor } from '@core/services/ArtistProcessor'
import { HumanBehavior } from '@core/services/HumanBehavior'
import { HealthMonitor } from '@core/health/HealthMonitor'
import { ReportService } from '@core/reporting/ReportService'
import { AutomationEngine } from '@core/engine/AutomationEngine'

/**
 * LIVE end-to-end test. Drives the REAL service code (same wiring as
 * AppContainer) against the live ReverbNation site using a copy of the app's
 * logged-in browser profile. Guarded by env so `npm test` never runs it.
 *
 *   LIVE=1 REVERB_PROFILE=<path> npx vitest run tests/live-run.test.ts
 */
const PROFILE = process.env.REVERB_PROFILE
const RUN = process.env.LIVE === '1' && !!PROFILE

describe.skipIf(!RUN)('LIVE ReverbNation end-to-end', () => {
  it(
    'authenticates, scans charts, saves artists with updates, and reports',
    async () => {
      const userDir = mkdtempSync(join(tmpdir(), 'reverb-live-'))
      const config = ConfigManager.load(userDir)

      // Point at the copied logged-in profile; small, fast, headless run.
      // Target the Global community list — exercises the exact three-dot row
      // interaction (menu → Add to Library → toast → Receive Updates → Yes).
      config.save({
        ...config.get(),
        activeLocationId: 'global',
        paths: { ...config.get().paths, browserProfilePath: PROFILE! },
        automation: {
          ...config.get().automation,
          artistsToSave: 30,
          receiveUpdates: true,
          headless: true,
          turbo: true,
          maxScrollPages: 6,
          scrollSpeed: 1200,
          clickDelay: { min: 80, max: 200 },
          randomDelay: { min: 150, max: 400 },
          maxRetries: 2,
          cycleLocations: false,
          exportReportOnFinish: true,
          reportFormat: 'csv'
        }
      })

      const cfg = config.get()
      const log = new Logger(cfg.paths.logsPath)
      const db = new Database(cfg.paths.databasePath)
      const browser = new BrowserManager(log)
      const human = new HumanBehavior(cfg.automation)
      const auth = new AuthService(browser, cfg.site, log)
      const nav = new NavigationService(browser, cfg.site, log)
      const scanner = new TrendingScanner(cfg.site, human, log)
      const library = new LibraryManager(cfg.site, human, log)
      const report = new ReportService(db, cfg.paths.reportsPath, log)
      const health = new HealthMonitor(browser, db)
      const engine = new AutomationEngine({
        config,
        db,
        log,
        browser,
        auth,
        nav,
        scanner,
        processorFactory: () =>
          new ArtistProcessor(browser, db, library, new HumanBehavior(config.get().automation), config.get().automation, log),
        health,
        report
      })

      const checks: Record<string, unknown> = {}
      try {
        const status = await engine.start()

        checks.engineState = status.engineState
        checks.authStatus = status.authStatus
        checks.browserStatus = browser.status
        checks.targetCount = status.targetCount
        checks.processed = status.processed
        checks.saved = status.saved
        checks.failed = status.failed
        checks.skipped = status.skipped

        const savedRecords = db.query({ status: 'saved', limit: 50 })
        checks.dbSavedCount = savedRecords.length
        checks.sampleSaved = savedRecords.slice(0, 5).map((r) => ({
          name: r.name,
          updates: r.updatesEnabled,
          url: r.profileUrl,
          durationMs: r.durationMs
        }))
        checks.namesResolved = savedRecords.filter((r) => r.name && !/^[a-z0-9-]+$/i.test(r.name)).length
        checks.updatesEnabledCount = savedRecords.filter((r) => r.updatesEnabled).length

        const reports = readdirSync(cfg.paths.reportsPath).filter((f) => f.startsWith('session-'))
        checks.reportFilesWritten = reports
        checks.reportExists = reports.length > 0
        checks.dbHealthy = db.ok()
        checks.logfileExists = existsSync(cfg.paths.logsPath)
        // Throughput extrapolation.
        checks.elapsedMs = status.elapsedMs
        checks.msPerSave = status.saved > 0 ? Math.round(status.elapsedMs / status.saved) : null
        checks.projected1000Min = status.saved > 0 ? Math.round((status.elapsedMs / status.saved) * 1000 / 60000) : null

        // eslint-disable-next-line no-console
        console.log('\n===== LIVE E2E RESULTS =====\n' + JSON.stringify(checks, null, 2) + '\n============================\n')

        // Assertions — "everything works"
        expect(status.authStatus).toBe('authenticated')
        expect(browser.status).toBe('ready')
        expect(['completed', 'idle']).toContain(status.engineState)
        // The exact row flow must complete a solid batch of fresh saves.
        expect(status.saved).toBeGreaterThanOrEqual(20)
        expect(db.savedCount()).toBeGreaterThanOrEqual(20)
        expect(checks.updatesEnabledCount as number).toBeGreaterThanOrEqual(20)
        expect(checks.reportExists).toBe(true)
        expect(db.ok()).toBe(true)
      } finally {
        health.stop()
        await browser.close()
        db.close()
        await log.close()
      }
    },
    360_000
  )
})
