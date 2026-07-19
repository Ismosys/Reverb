import { cpSync, mkdtempSync } from 'node:fs'
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
import { ProfileRotationManager } from '@core/rotation/ProfileRotationManager'
import { LibraryManager } from '@core/services/LibraryManager'
import { ArtistProcessor } from '@core/services/ArtistProcessor'
import { HumanBehavior } from '@core/services/HumanBehavior'
import { HealthMonitor } from '@core/health/HealthMonitor'
import { ReportService } from '@core/reporting/ReportService'
import { AutomationEngine } from '@core/engine/AutomationEngine'

const PROFILE = process.env.REVERB_PROFILE
const RUN = process.env.LIVE === '1' && !!PROFILE

describe.skipIf(!RUN)('LIVE account rotation', () => {
  it(
    'rotates across accounts, respects the per-account limit, dedups globally',
    async () => {
      const userDir = mkdtempSync(join(tmpdir(), 'reverb-liverot-'))
      const config = ConfigManager.load(userDir)
      config.addProfile('Account 2')
      const profiles = config.listProfiles()
      const second = profiles.find((p) => p.name === 'Account 2')!

      // Give BOTH accounts a logged-in session (same real account → exercises
      // global dedup: account 2 must skip whatever account 1 already saved).
      for (const p of profiles) {
        cpSync(PROFILE!, config.profilePaths(p.id).browserProfilePath, { recursive: true })
      }

      config.save({
        ...config.get(),
        locations: [
          ...config.get().locations,
          { id: 'manila', label: 'Manila, Philippines', type: 'custom', latitude: 14.5995, longitude: 120.9842, query: 'Manila' }
        ],
        activeLocationId: 'manila',
        automation: {
          ...config.get().automation,
          artistsToSave: 16,
          perProfileLimit: 8,
          rotateProfiles: true,
          receiveUpdates: true,
          headless: true,
          turbo: true,
          maxRetries: 2
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
      const rotation = new ProfileRotationManager(config, log)
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
        rotation,
        processorFactory: () =>
          new ArtistProcessor(browser, db, library, new HumanBehavior(config.get().automation), config.get().automation, log),
        health,
        report
      })

      try {
        const status = await engine.start()
        const byProfile = db.savedCountByProfile()
        const savedRecords = db.query({ status: 'saved', limit: 100 })
        const uniqueIds = new Set(savedRecords.map((r) => r.artistId))

        const out = {
          engineState: status.engineState,
          saved: status.saved,
          failed: status.failed,
          target: status.targetCount,
          savedByProfile: byProfile,
          accountsUsed: Object.keys(byProfile).length,
          uniqueSaved: uniqueIds.size,
          totalSavedRows: savedRecords.length
        }
        // eslint-disable-next-line no-console
        console.log('\n===== LIVE ROTATION =====\n' + JSON.stringify(out, null, 2) + '\n=========================\n')

        expect(status.saved).toBeGreaterThanOrEqual(14)
        // Rotation actually happened: BOTH accounts contributed saves.
        expect(Object.keys(byProfile).length).toBe(2)
        expect(byProfile['default']).toBeGreaterThanOrEqual(6)
        expect(byProfile[second.id]).toBeGreaterThanOrEqual(6)
        // Per-account limit respected.
        for (const c of Object.values(byProfile)) expect(c).toBeLessThanOrEqual(8)
        // Global dedup: no artist saved twice.
        expect(uniqueIds.size).toBe(savedRecords.length)
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
