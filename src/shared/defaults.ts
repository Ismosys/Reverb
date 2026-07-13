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
  loggedOutIndicator: 'a.qa-login',
  geoSelect: 'select[name="geo"]',
  // Vanity-profile anchors on the charts listing (excluding site routes handled in code).
  artistProfileLink: 'a[href^="/"]',
  becomeFanButton: 'a.button--add--profile, a.qa-become-fan, a.ng-scope.button--primary:has-text("Become A Fan")',
  removeFanButton: 'a.button--added--profile, a:has-text("Remove Fan")',
  fanConfirmYes: 'a.js-fan-action:has-text("Yes")',
  fanConfirmNo: 'a.js-fan-action:has-text("No")'
}

/** The four geo scopes ReverbNation Charts supports. */
export const DEFAULT_LOCATIONS: TrendingLocation[] = [
  { id: 'global', label: 'Global', type: 'global', geoValue: 'string:global', favorite: true },
  { id: 'national', label: 'National', type: 'national', geoValue: 'string:national', favorite: true },
  { id: 'regional', label: 'Regional', type: 'regional', geoValue: 'string:regional' },
  { id: 'local', label: 'Local', type: 'local', geoValue: 'string:local' }
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
