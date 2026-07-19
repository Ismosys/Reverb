import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildDefaultConfig, DEFAULT_PROFILE_ID } from '@shared/defaults'
import type { AppConfig, AutomationSettings, PathsConfig, Profile, ProfileInfo, TrendingLocation } from '@shared/types'
import { ConfigError } from '../utils/errors'
import { TypedEmitter } from '../utils/events'
import { appConfigSchema } from './schema'

type ConfigEvents = { changed: AppConfig }

/**
 * Loads, validates, persists and mutates the application configuration.
 *
 * The config file is a plain JSON document so users can hand-edit it. Invalid
 * or partial files are merged over defaults and re-validated, so the app always
 * boots with a usable config rather than crashing.
 */
export class ConfigManager extends TypedEmitter<ConfigEvents> {
  private config: AppConfig
  private readonly configFilePath: string
  private readonly userDataDir: string

  private constructor(configFilePath: string, userDataDir: string, config: AppConfig) {
    super()
    this.configFilePath = configFilePath
    this.userDataDir = userDataDir
    this.config = config
  }

  /**
   * Resolve the on-disk paths for a given profile.
   *
   * The database and reports are GLOBAL (shared across every account) so that
   * duplicate artists are prevented pool-wide and progress is centralized. Only
   * the browser session is per-profile (isolated logins). Logs are shared.
   */
  static resolvePaths(userDataDir: string, profileId: string): PathsConfig {
    return {
      databasePath: join(userDataDir, 'data', 'reverb.db'),
      browserProfilePath: join(userDataDir, 'profiles', profileId, 'browser-profile'),
      reportsPath: join(userDataDir, 'reports'),
      logsPath: join(userDataDir, 'logs', 'reverb.log')
    }
  }

  /** Promote a legacy per-profile database/reports to the global location. */
  private static migrateToGlobal(userDataDir: string, profileId: string): void {
    try {
      for (const name of ['data', 'reports']) {
        const legacy = join(userDataDir, 'profiles', profileId, name)
        const global = join(userDataDir, name)
        if (existsSync(legacy) && !existsSync(global)) renameSync(legacy, global)
      }
    } catch {
      // Best-effort; a fresh global DB works regardless.
    }
  }

  /**
   * One-time migration of legacy single-profile data (browser-profile, data,
   * reports directly under userData) into the default profile's directory, so
   * upgrading users keep their existing login and history.
   */
  private static migrateLegacy(userDataDir: string, profileId: string): void {
    const dir = join(userDataDir, 'profiles', profileId)
    try {
      mkdirSync(dir, { recursive: true })
      for (const name of ['browser-profile', 'data', 'reports']) {
        const src = join(userDataDir, name)
        const dst = join(dir, name)
        if (existsSync(src) && !existsSync(dst)) renameSync(src, dst)
      }
    } catch {
      // Migration is best-effort; a fresh profile dir works regardless.
    }
  }

  /**
   * Build a ConfigManager rooted at `userDataDir`, using the active profile's
   * paths. Migrates legacy data on first upgrade and validates the result.
   */
  static load(userDataDir: string): ConfigManager {
    const configFilePath = join(userDataDir, 'config.json')

    let raw: Partial<AppConfig> = {}
    if (existsSync(configFilePath)) {
      try {
        raw = JSON.parse(readFileSync(configFilePath, 'utf-8')) as Partial<AppConfig>
      } catch {
        raw = {}
      }
    }

    // Determine profiles + active profile (with legacy migration on first run).
    const hadProfiles = Array.isArray(raw.profiles) && raw.profiles.length > 0
    const profiles: Profile[] = hadProfiles
      ? (raw.profiles as Profile[]).map((p) => ({ ...p, createdAt: p.createdAt || new Date().toISOString() }))
      : [{ id: DEFAULT_PROFILE_ID, name: 'Account 1', createdAt: new Date().toISOString() }]
    let activeProfileId = raw.activeProfileId && profiles.some((p) => p.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0].id
    if (!hadProfiles) ConfigManager.migrateLegacy(userDataDir, activeProfileId)
    // Promote the (default) profile's data/reports to the global location.
    ConfigManager.migrateToGlobal(userDataDir, activeProfileId)

    const paths = ConfigManager.resolvePaths(userDataDir, activeProfileId)
    const defaults = buildDefaultConfig(paths)
    let merged = ConfigManager.mergeDeep(defaults, raw)
    // Profiles/active/paths are authoritative here, not from the raw merge.
    merged = { ...merged, profiles, activeProfileId, paths }

    const parsed = appConfigSchema.safeParse(merged)
    const config = parsed.success ? (parsed.data as AppConfig) : { ...defaults, profiles, activeProfileId, paths }
    const mgr = new ConfigManager(configFilePath, userDataDir, config)
    mgr.persist()
    return mgr
  }

  /** Shallow-typed deep merge (objects merge, arrays/scalars replace). */
  private static mergeDeep(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
    const out: AppConfig = { ...base }
    for (const key of Object.keys(patch) as (keyof AppConfig)[]) {
      const value = patch[key]
      if (value === undefined) continue
      const target = out as unknown as Record<string, unknown>
      if (Array.isArray(value) || typeof value !== 'object' || value === null) {
        target[key as string] = value
      } else {
        target[key as string] = { ...(base[key] as object), ...(value as object) }
      }
    }
    return out
  }

  get(): AppConfig {
    return this.config
  }

  get paths() {
    return this.config.paths
  }

  get site() {
    return this.config.site
  }

  get automation(): AutomationSettings {
    return this.config.automation
  }

  /** Replace the full config after validating it. */
  save(next: AppConfig): AppConfig {
    const parsed = appConfigSchema.safeParse(next)
    if (!parsed.success) {
      throw new ConfigError(`Invalid configuration: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
    }
    this.config = parsed.data as AppConfig
    this.persist()
    this.emit('changed', this.config)
    return this.config
  }

  /** Update just the automation settings block. */
  updateAutomation(partial: Partial<AutomationSettings>): AppConfig {
    return this.save({ ...this.config, automation: { ...this.config.automation, ...partial } })
  }

  /* --------------------------- Locations --------------------------- */

  listLocations(): TrendingLocation[] {
    return this.config.locations
  }

  getActiveLocation(): TrendingLocation | null {
    const id = this.config.activeLocationId
    return this.config.locations.find((l) => l.id === id) ?? null
  }

  addLocation(location: TrendingLocation): AppConfig {
    const locations = this.config.locations.filter((l) => l.id !== location.id)
    locations.push(location)
    return this.save({ ...this.config, locations })
  }

  removeLocation(id: string): AppConfig {
    const locations = this.config.locations.filter((l) => l.id !== id)
    const activeLocationId = this.config.activeLocationId === id ? (locations[0]?.id ?? null) : this.config.activeLocationId
    return this.save({ ...this.config, locations, activeLocationId })
  }

  setActiveLocation(id: string | null): AppConfig {
    if (id !== null && !this.config.locations.some((l) => l.id === id)) {
      throw new ConfigError(`Unknown location id: ${id}`)
    }
    return this.save({ ...this.config, activeLocationId: id })
  }

  toggleFavorite(id: string): AppConfig {
    const locations = this.config.locations.map((l) => (l.id === id ? { ...l, favorite: !l.favorite } : l))
    return this.save({ ...this.config, locations })
  }

  /** Set the ordered list of locations to cycle through (unknown ids dropped). */
  setCycleLocationIds(ids: string[]): AppConfig {
    const known = new Set(this.config.locations.map((l) => l.id))
    const filtered = ids.filter((id) => known.has(id))
    return this.save({ ...this.config, cycleLocationIds: filtered })
  }

  /**
   * Resolve the ordered locations a run should visit.
   * - Cycling off → just the active location (or []).
   * - Cycling on  → `cycleLocationIds` in order; falls back to favorites, then
   *   all locations, so enabling the toggle never yields an empty run.
   */
  resolveRunLocations(): TrendingLocation[] {
    const byId = new Map(this.config.locations.map((l) => [l.id, l]))
    if (!this.config.automation.cycleLocations) {
      const active = this.getActiveLocation()
      return active ? [active] : []
    }
    const fromIds = this.config.cycleLocationIds.map((id) => byId.get(id)).filter((l): l is TrendingLocation => !!l)
    if (fromIds.length > 0) return fromIds
    const favorites = this.config.locations.filter((l) => l.favorite)
    if (favorites.length > 0) return favorites
    return [...this.config.locations]
  }

  /* --------------------------- Profiles ---------------------------- */

  listProfiles(): Profile[] {
    return this.config.profiles
  }

  getActiveProfile(): Profile {
    return this.config.profiles.find((p) => p.id === this.config.activeProfileId) ?? this.config.profiles[0]
  }

  /** Resolve paths for any profile (used when rotating the active browser). */
  profilePaths(profileId: string): PathsConfig {
    return ConfigManager.resolvePaths(this.userDataDir, profileId)
  }

  /**
   * Profiles enriched with active flag and whether a session is saved. The
   * database-derived fields (savedCount, lastActivity) default here and are
   * filled by the IPC layer, which has the global database.
   */
  profilesInfo(): ProfileInfo[] {
    return this.config.profiles.map((p) => ({
      ...p,
      active: p.id === this.config.activeProfileId,
      hasSession: this.profileHasSession(p.id),
      savedCount: 0,
      lastActivity: null
    }))
  }

  /** True if the profile has a persisted browser session (cookies present). */
  profileHasSession(id: string): boolean {
    const dir = join(this.userDataDir, 'profiles', id, 'browser-profile')
    return existsSync(join(dir, 'Default', 'Cookies')) || existsSync(join(dir, 'Cookies'))
  }

  /** Create a new (empty) account profile. Does not switch to it. */
  addProfile(name: string): AppConfig {
    const label = name.trim() || `Account ${this.config.profiles.length + 1}`
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'account'
    let id = `p-${base}`
    let n = 2
    while (this.config.profiles.some((p) => p.id === id)) id = `p-${base}-${n++}`
    const profile: Profile = { id, name: label, createdAt: new Date().toISOString() }
    return this.save({ ...this.config, profiles: [...this.config.profiles, profile] })
  }

  renameProfile(id: string, name: string): AppConfig {
    const profiles = this.config.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p))
    return this.save({ ...this.config, profiles })
  }

  /** Remove a profile and delete its data directory. Cannot remove the last. */
  removeProfile(id: string): AppConfig {
    if (this.config.profiles.length <= 1) throw new ConfigError('At least one account is required')
    const profiles = this.config.profiles.filter((p) => p.id !== id)
    let activeProfileId = this.config.activeProfileId
    let paths = this.config.paths
    if (activeProfileId === id) {
      activeProfileId = profiles[0].id
      paths = ConfigManager.resolvePaths(this.userDataDir, activeProfileId)
    }
    const next = this.save({ ...this.config, profiles, activeProfileId, paths })
    try {
      rmSync(join(this.userDataDir, 'profiles', id), { recursive: true, force: true })
    } catch {
      // Non-fatal: the config no longer references it.
    }
    return next
  }

  /** Switch the active profile and recompute its paths. */
  setActiveProfile(id: string): AppConfig {
    if (!this.config.profiles.some((p) => p.id === id)) throw new ConfigError(`Unknown profile: ${id}`)
    const paths = ConfigManager.resolvePaths(this.userDataDir, id)
    return this.save({ ...this.config, activeProfileId: id, paths })
  }

  /** Reset settings to defaults (keeps profiles + active profile + paths). */
  reset(): AppConfig {
    const fresh = buildDefaultConfig(this.config.paths)
    return this.save({
      ...fresh,
      profiles: this.config.profiles,
      activeProfileId: this.config.activeProfileId,
      paths: this.config.paths
    })
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.configFilePath), { recursive: true })
      writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch (err) {
      throw new ConfigError('Failed to persist configuration', err)
    }
  }
}
