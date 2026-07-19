import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '@core/config/ConfigManager'
import { Logger } from '@core/logging/Logger'
import { Database } from '@core/db/Database'
import { ProfileRotationManager } from '@core/rotation/ProfileRotationManager'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'reverb-rot-'))
  const config = ConfigManager.load(dir)
  const log = new Logger(config.get().paths.logsPath)
  return { dir, config, log }
}

describe('ProfileRotationManager', () => {
  it('single account when rotation is off', () => {
    const { config, log } = setup()
    const rot = new ProfileRotationManager(config, log)
    rot.begin(false)
    expect(rot.status(100).enabled).toBe(false)
    expect(rot.current()?.id).toBe('default')
  })

  it('rotates across the pool, respecting the per-account limit', () => {
    const { config, log } = setup()
    // Two accounts (only those with a session are eligible; simulate sessions by
    // marking hasSession — here we just add profiles and treat all as eligible).
    config.addProfile('Two')
    config.addProfile('Three')
    const rot = new ProfileRotationManager(config, log)

    // Force all profiles eligible for the test (no real browser sessions).
    ;(rot as unknown as { eligibleProfiles: () => unknown }).eligibleProfiles = () => config.listProfiles()

    rot.begin(true)
    expect(rot.status(100).profilesTotal).toBe(3)

    // Account 1 saves up to the limit, then rotates.
    const limit = 5
    for (let i = 0; i < limit; i++) {
      expect(rot.limitReached(limit)).toBe(false)
      rot.recordSave()
    }
    expect(rot.limitReached(limit)).toBe(true)
    expect(rot.currentCount()).toBe(5)

    const first = rot.current()!.id
    const next = rot.advance()!
    expect(next.id).not.toBe(first)
    expect(rot.currentCount()).toBe(0) // fresh account
    expect(rot.status(limit).profilesFinished).toBe(1)
    expect(rot.status(limit).rotationNumber).toBe(2)

    rot.advance() // account 3
    expect(rot.advance()).toBeNull() // pool exhausted
    expect(rot.hasMore()).toBe(false)
  })

  it('unlimited limit never rotates on count', () => {
    const { config, log } = setup()
    const rot = new ProfileRotationManager(config, log)
    rot.begin(false)
    for (let i = 0; i < 500; i++) rot.recordSave()
    expect(rot.limitReached(0)).toBe(false)
  })
})

describe('Global database dedup', () => {
  it('is skipped globally regardless of which account saved it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reverb-gdb-'))
    const db = new Database(join(dir, 'data', 'reverb.db'))

    db.upsertDiscovered({ artistId: '111', name: 'A', profileUrl: 'u', locationLabel: null })
    expect(db.isCompleted('111')).toBe(false)

    // Account "p2" saves artist 111.
    db.markResult('111', { status: 'saved', updatesEnabled: true, profileId: 'p2' })
    expect(db.isCompleted('111')).toBe(true) // now globally complete

    // Stats reflect the account that saved it.
    const stats = db.stats()
    expect(stats.saved).toBe(1)
    expect(stats.profilesUsed).toBe(1)
    expect(db.savedCountByProfile()).toEqual({ p2: 1 })
    db.close()
  })
})
