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
 * Best-effort ReverbNation selectors. These are the single point of coupling to
 * the live site; when the markup changes, tune these values in config instead
 * of editing code. Multiple candidate selectors are comma-separated so the
 * automation can fall back gracefully.
 */
export const DEFAULT_SITE: SiteSelectors = {
  baseUrl: 'https://www.reverbnation.com',
  trendingPath: '/main/trending',
  loggedInIndicator:
    '[data-testid="user-menu"], a[href*="/logout"], .account-menu, .user-avatar',
  loginPath: '/login',
  artistCard:
    '[data-testid="artist-card"], .artist_card, .trending_artist, li[data-artist-id]',
  artistName:
    '[data-testid="artist-name"], .artist_name, .name a, h3 a',
  artistLink: 'a[href*="/artist/"], a[href*="/"]',
  saveButton:
    'button[data-testid="save-to-library"], button:has-text("Save"), .save_to_library, .fan-button',
  savedState:
    'button[data-testid="save-to-library"][aria-pressed="true"], .saved, button:has-text("Saved"), .fanned',
  updatesButton:
    'button[data-testid="receive-updates"], button:has-text("Receive updates"), .notify-button',
  updatesEnabledState:
    'button[data-testid="receive-updates"][aria-pressed="true"], .updates-on, button:has-text("Updates on")',
  locationSelector:
    '[data-testid="location-selector"], .location-selector, select[name="location"]',
  locationSearchInput:
    'input[data-testid="location-search"], input[placeholder*="location" i], input[name="location"]',
  locationOption:
    '[data-testid="location-option"], .location-option, li[role="option"]'
}

export const DEFAULT_LOCATIONS: TrendingLocation[] = [
  { id: 'global', label: 'Global', type: 'region', favorite: true },
  { id: 'us', label: 'United States', type: 'country', country: 'United States', favorite: true }
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
