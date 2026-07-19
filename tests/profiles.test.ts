import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '@core/config/ConfigManager'

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'reverb-profiles-'))
}

describe('ConfigManager profiles', () => {
  it('starts with one default profile and per-profile paths', () => {
    const cfg = ConfigManager.load(freshDir())
    expect(cfg.listProfiles()).toHaveLength(1)
    expect(cfg.getActiveProfile().id).toBe('default')
    expect(cfg.get().paths.browserProfilePath.replace(/\\/g, '/')).toContain('profiles/default/browser-profile')
    // Database is GLOBAL (shared across accounts), not per-profile.
    expect(cfg.get().paths.databasePath.replace(/\\/g, '/')).toMatch(/\/data\/reverb\.db$/)
    expect(cfg.get().paths.databasePath.replace(/\\/g, '/')).not.toContain('profiles/')
  })

  it('adds, switches, and isolates each account’s paths', () => {
    const cfg = ConfigManager.load(freshDir())
    cfg.addProfile('Second Account')
    const profiles = cfg.listProfiles()
    expect(profiles).toHaveLength(2)
    const second = profiles.find((p) => p.name === 'Second Account')!
    expect(second.id).not.toBe('default')

    const p1 = cfg.get().paths.browserProfilePath
    cfg.setActiveProfile(second.id)
    const p2 = cfg.get().paths.browserProfilePath
    expect(p2).not.toBe(p1) // isolated session dirs
    expect(p2.replace(/\\/g, '/')).toContain(`profiles/${second.id}/browser-profile`)
    expect(cfg.getActiveProfile().id).toBe(second.id)
  })

  it('migrates legacy single-profile data into the default profile', () => {
    const dir = freshDir()
    // Simulate a pre-multi-account install with a saved session + db.
    mkdirSync(join(dir, 'browser-profile', 'Default'), { recursive: true })
    writeFileSync(join(dir, 'browser-profile', 'Default', 'Cookies'), 'x')
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'reverb.db'), 'x')

    const cfg = ConfigManager.load(dir)
    // Session stays per-profile; the database is promoted to the GLOBAL location.
    expect(existsSync(join(dir, 'profiles', 'default', 'browser-profile', 'Default', 'Cookies'))).toBe(true)
    expect(existsSync(join(dir, 'data', 'reverb.db'))).toBe(true)
    expect(existsSync(join(dir, 'browser-profile'))).toBe(false) // moved, not copied
    expect(cfg.profileHasSession('default')).toBe(true)
  })

  it('reports session presence and refuses to remove the last account', () => {
    const cfg = ConfigManager.load(freshDir())
    expect(cfg.profileHasSession('default')).toBe(false)
    expect(() => cfg.removeProfile('default')).toThrow()

    cfg.addProfile('Temp')
    const temp = cfg.listProfiles().find((p) => p.name === 'Temp')!
    cfg.removeProfile(temp.id)
    expect(cfg.listProfiles()).toHaveLength(1)
  })

  it('picks a surviving account when the active one is removed', () => {
    const cfg = ConfigManager.load(freshDir())
    cfg.addProfile('Two')
    const two = cfg.listProfiles().find((p) => p.name === 'Two')!
    cfg.setActiveProfile(two.id)
    cfg.removeProfile(two.id)
    expect(cfg.getActiveProfile().id).toBe('default')
    expect(cfg.get().paths.browserProfilePath.replace(/\\/g, '/')).toContain('profiles/default/')
  })
})
