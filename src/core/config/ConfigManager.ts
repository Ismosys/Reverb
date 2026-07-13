import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildDefaultConfig } from '@shared/defaults'
import type { AppConfig, AutomationSettings, TrendingLocation } from '@shared/types'
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

  private constructor(configFilePath: string, config: AppConfig) {
    super()
    this.configFilePath = configFilePath
    this.config = config
  }

  /**
   * Build a ConfigManager rooted at `userDataDir`. Resolves default paths,
   * loads any existing config file and validates the merged result.
   */
  static load(userDataDir: string): ConfigManager {
    const configFilePath = join(userDataDir, 'config.json')
    const defaults = buildDefaultConfig({
      databasePath: join(userDataDir, 'data', 'reverb.db'),
      browserProfilePath: join(userDataDir, 'browser-profile'),
      reportsPath: join(userDataDir, 'reports'),
      logsPath: join(userDataDir, 'logs', 'reverb.log')
    })

    let merged: AppConfig = defaults
    if (existsSync(configFilePath)) {
      try {
        const raw = JSON.parse(readFileSync(configFilePath, 'utf-8')) as Partial<AppConfig>
        merged = ConfigManager.mergeDeep(defaults, raw)
      } catch (err) {
        // Corrupt file: fall back to defaults rather than blocking startup.
        merged = defaults
        void err
      }
    }

    const parsed = appConfigSchema.safeParse(merged)
    const config = parsed.success ? (parsed.data as AppConfig) : defaults
    const mgr = new ConfigManager(configFilePath, config)
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

  /** Reset everything to defaults (keeps resolved paths). */
  reset(): AppConfig {
    const fresh = buildDefaultConfig(this.config.paths)
    return this.save(fresh)
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
