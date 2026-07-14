/**
 * Shared type contracts used across the main process, preload bridge and
 * renderer. This module MUST stay free of Node/Electron imports so it can be
 * bundled into the browser renderer as well as the main process.
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * A trending "location" the automation targets on ReverbNation's Charts.
 *
 * - `global`  — the worldwide chart (ReverbNation `/api/charts/global`).
 * - `custom`  — an actual place the user searched for; resolved to coordinates
 *   and served by the local chart (`/api/charts/local` by latitude/longitude).
 */
export interface TrendingLocation {
  /** Stable identifier (e.g. "global" or a slug of the place). */
  id: string
  /** Human friendly label, e.g. "Austin, Texas, United States". */
  label: string
  type: 'global' | 'custom'
  /** Coordinates for `custom` locations (from geocoding). */
  latitude?: number
  longitude?: number
  /** The original text the user searched, for reference. */
  query?: string
  /** Marked by the user as a favorite for quick access. */
  favorite?: boolean
}

/** A geocoded place returned by a location search. */
export interface GeocodeResult {
  label: string
  latitude: number
  longitude: number
}

/** Delay range in milliseconds used to randomise pacing. */
export interface DelayRange {
  min: number
  max: number
}

/** Everything the automation run can be tuned with. */
export interface AutomationSettings {
  /** Target number of artists to save in a run. */
  artistsToSave: number
  /** Whether to enable "Receive updates" on each saved artist. */
  receiveUpdates: boolean
  /** Hard cap on scroll iterations while loading the trending grid. */
  maxScrollPages: number
  /** Retry attempts for individual recoverable actions. */
  maxRetries: number
  /** Pixels-per-step scroll speed factor (higher = faster). */
  scrollSpeed: number
  /** Delay applied around clicks (ms range). */
  clickDelay: DelayRange
  /** Run the browser without a visible window. */
  headless: boolean
  /** Parallel artist workers (kept low to look human & respect the site). */
  concurrentWorkers: number
  /** Randomised delay applied between artists (ms range). */
  randomDelay: DelayRange
  /** Abort the whole run after this many ms (0 = unlimited). */
  maxExecutionTimeMs: number
  /** Resume from the previous unfinished session on start. */
  resumePreviousSession: boolean
  /** Abort the run after this many consecutive failures (0 = never). */
  stopAfterFailures: number
  /** When true, the run cycles through `cycleLocationIds`, targeting
   *  `artistsToSave` artists at EACH location in turn. */
  cycleLocations: boolean
  /** Automatically export a report when the run finishes. */
  exportReportOnFinish: boolean
  /** Report format used for the auto-export. */
  reportFormat: ReportFormat
}

export type ReportFormat = 'csv' | 'json' | 'xlsx'

/** Paths the app persists data to. Resolved against userData by default. */
export interface PathsConfig {
  databasePath: string
  browserProfilePath: string
  reportsPath: string
  logsPath: string
}

/** The full, validated application configuration. */
export interface AppConfig {
  automation: AutomationSettings
  activeLocationId: string | null
  locations: TrendingLocation[]
  /** Ordered location ids to visit when `automation.cycleLocations` is on. */
  cycleLocationIds: string[]
  paths: PathsConfig
  /** CSS selectors + URLs for the ReverbNation site (kept configurable so the
   *  app survives site markup changes without a code deploy). */
  site: SiteSelectors
}

/**
 * Site-specific coupling to ReverbNation, kept in config so it can be tuned
 * without a code change. Discovery uses the JSON charts API and fanning uses the
 * became-a-fan POST, so only session/auth landing selectors are needed here.
 */
export interface SiteSelectors {
  baseUrl: string
  /** The Charts page — used to establish the session and read genre options. */
  chartsPath: string
  loginPath: string
  /** Present only when logged IN (My Library / Log Out nav links). */
  loggedInIndicator: string
  /** Present only when logged OUT (the "Log In" nav link). */
  loggedOutIndicator: string
}

/* ------------------------------------------------------------------ */
/* Domain / database                                                   */
/* ------------------------------------------------------------------ */

export type ArtistStatus =
  | 'pending'
  | 'processing'
  | 'saved'
  | 'skipped'
  | 'failed'

export interface ArtistRecord {
  /** ReverbNation artist id (derived from profile URL). */
  artistId: string
  name: string
  profileUrl: string
  status: ArtistStatus
  updatesEnabled: boolean
  retryCount: number
  failureReason: string | null
  /** Location label the artist was discovered under. */
  locationLabel: string | null
  /** Processing duration in ms. */
  durationMs: number | null
  /** ISO timestamp when first seen. */
  createdAt: string
  /** ISO timestamp when processing completed. */
  processedAt: string | null
}

/* ------------------------------------------------------------------ */
/* Runtime status / telemetry                                          */
/* ------------------------------------------------------------------ */

export type EngineState =
  | 'idle'
  | 'starting'
  | 'authenticating'
  | 'navigating'
  | 'scanning'
  | 'processing'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'error'

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated' | 'expired'

export type BrowserStatus = 'closed' | 'launching' | 'ready' | 'crashed'

/** Live snapshot pushed to the dashboard. */
export interface RunStatus {
  engineState: EngineState
  authStatus: AuthStatus
  browserStatus: BrowserStatus
  activeLocationLabel: string | null
  targetCount: number
  processed: number
  remaining: number
  saved: number
  skipped: number
  failed: number
  currentArtist: string | null
  currentOperation: string | null
  /** Whole-run progress 0..1. */
  progress: number
  /** ms since run start. */
  elapsedMs: number
  /** Estimated ms to completion (null when unknown). */
  etaMs: number | null
  /** Artists completed per minute. */
  speedPerMin: number
  startedAt: string | null
}

export interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  action: string
  status: string
  message: string
  artist?: string | null
  retryCount?: number
  durationMs?: number | null
  error?: string | null
}

export interface HealthSnapshot {
  browser: BrowserStatus
  database: 'ok' | 'error'
  network: 'online' | 'offline' | 'degraded'
  automation: EngineState
  memoryMb: number
  cpuPercent: number
  timestamp: string
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

export interface SessionReport {
  sessionId: string
  startTime: string
  endTime: string
  durationMs: number
  locationLabel: string | null
  processed: number
  saved: number
  failed: number
  skipped: number
  averageProcessingMs: number
  artists: ArtistRecord[]
}

/* ------------------------------------------------------------------ */
/* IPC contract                                                        */
/* ------------------------------------------------------------------ */

/** Standard envelope returned by every IPC handler. */
export interface IpcResult<T = void> {
  ok: boolean
  data?: T
  error?: string
}

/** Channels the renderer can invoke on the main process. */
export const IpcChannels = {
  configGet: 'config:get',
  configSave: 'config:save',
  configReset: 'config:reset',
  locationsList: 'locations:list',
  locationAdd: 'location:add',
  locationRemove: 'location:remove',
  locationSetActive: 'location:setActive',
  locationToggleFavorite: 'location:toggleFavorite',
  locationSetCycle: 'location:setCycle',
  locationAddByName: 'location:addByName',
  authLogin: 'auth:login',
  authCheck: 'auth:check',
  engineStart: 'engine:start',
  enginePause: 'engine:pause',
  engineResume: 'engine:resume',
  engineStop: 'engine:stop',
  engineTestConnection: 'engine:testConnection',
  dbQuery: 'db:query',
  dbDelete: 'db:delete',
  dbClear: 'db:clear',
  dbExport: 'db:export',
  reportExport: 'report:export',
  logsExport: 'logs:export',
  healthGet: 'health:get'
} as const

/** Events the main process pushes to the renderer. */
export const IpcEvents = {
  status: 'evt:status',
  log: 'evt:log',
  health: 'evt:health',
  artistUpdated: 'evt:artistUpdated'
} as const

/** Query parameters for searching the artist database. */
export interface ArtistQuery {
  search?: string
  status?: ArtistStatus | 'all'
  limit?: number
  offset?: number
}
