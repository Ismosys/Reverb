import type { AppConfig, AutomationSettings, SiteSelectors, TrendingLocation } from './types'

/**
 * Factory-default configuration. Paths are intentionally left as empty strings
 * here — the ConfigManager resolves them against Electron's userData directory
 * at load time (this module stays Electron-free so it is importable anywhere).
 */

export const DEFAULT_AUTOMATION: AutomationSettings = {
  artistsToSave: 25,
  receiveUpdates: true,
  maxScrollPages: 15,
  maxRetries: 3,
  scrollSpeed: 800,
  clickDelay: { min: 400, max: 1200 },
  headless: false,
  concurrentWorkers: 1,
  randomDelay: { min: 1500, max: 4000 },
  maxExecutionTimeMs: 0,
  resumePreviousSession: true,
  stopAfterFailures: 10,
  cycleLocations: false,
  turbo: true,
  exportReportOnFinish: true,
  reportFormat: 'csv'
}

/**
 * ReverbNation selectors, verified against the live (AngularJS) site. This is the
 * single point of coupling to the site; when the markup changes, tune these here
 * (or in config) instead of editing service code. Comma-separated candidates let
 * the automation fall back gracefully.
 */
export const DEFAULT_SITE: SiteSelectors = {
  baseUrl: 'https://www.reverbnation.com',
  chartsPath: '/main/charts',
  loginPath: '/login',
  loggedInIndicator: 'a.qa-library, a.qa-log-out, a.qa-user-icon',
  loggedOutIndicator: 'a.qa-login'
}

/** The worldwide chart; users add actual places via location search. */
export const DEFAULT_LOCATIONS: TrendingLocation[] = [
  { id: 'global', label: 'Global', type: 'global', favorite: true }
]

/** Build a complete default config given resolved paths. */
export function buildDefaultConfig(paths: AppConfig['paths']): AppConfig {
  return {
    automation: { ...DEFAULT_AUTOMATION },
    activeLocationId: 'global',
    locations: DEFAULT_LOCATIONS.map((l) => ({ ...l })),
    cycleLocationIds: [],
    paths,
    site: { ...DEFAULT_SITE }
  }
}
