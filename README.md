# Reverb

A production-grade **desktop automation application for ReverbNation**, built with
**Electron + React + TypeScript + Playwright**. Reverb browses ReverbNation's
_“Trending in the Community”_ section, saves trending artists to your library,
enables update notifications for each, and lets you switch trending locations —
all from a polished desktop dashboard with live progress, logging, reporting and
a persistent SQLite database.

> ⚠️ **Use responsibly.** This tool automates **your own** ReverbNation account.
> Automating a website may be restricted by its Terms of Service. Reverb ships
> with conservative, human-like pacing (randomised delays, natural scrolling) so
> you can keep request rates low. You are responsible for using it within
> ReverbNation's terms and applicable law. No credentials are ever stored — you
> log in once through a real browser window and the session is persisted locally.

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Installation](#installation)
4. [Scripts](#scripts)
5. [Configuration](#configuration)
6. [Usage](#usage)
7. [Data & Reports](#data--reports)
8. [Site Selectors (keeping up with ReverbNation)](#site-selectors)
9. [Extending Reverb](#extending-reverb)
10. [Troubleshooting](#troubleshooting)

---

## Features

- **Persistent authentication** — log in once in a real browser window; the
  Playwright persistent profile keeps the session across restarts. Expired
  sessions are detected and you're prompted to re-authenticate only when needed.
- **Full automation workflow** — launch → authenticate → open Trending →
  wait for content → auto-scroll → collect artists → open profile → save →
  enable updates → verify → repeat until the target is reached.
- **Trending location control** — country / state / city / region, applied via
  a layered strategy (native selector → search field → URL parameters).
  Save favorites and switch the active location from the UI.
- **Multi-location cycling** — enable “Cycle through multiple locations” and the
  engine runs one pass per selected location in order. `artistsToSave` is the
  **total** for the run, split evenly across the visited locations (remainder
  front-loaded — e.g. 10 artists over 3 cities → 4 / 3 / 3). Falls back to your
  favorites (then all locations) if no explicit cycle list is set.
- **Resilient engine** — typed retries with exponential backoff, stale-page
  refresh, browser-crash recovery, skip-already-processed, and continue-on-error
  so a single bad artist never aborts a run.
- **Live dashboard** — account status, current location, processed / remaining /
  saved / skipped / failed counts, ETA, speed, progress bar, current artist and
  operation, plus a running timer.
- **Real-time logs** — timestamp, action, status, message, retry count and
  duration; exportable to JSON.
- **SQLite persistence** — every artist tracked (id, name, URL, status, updates
  enabled, retries, failure reason, duration, timestamps). Searchable and
  exportable.
- **Reporting** — CSV, JSON and Excel exports, plus per-session summary reports.
- **System health** — browser / database / network / automation status with
  memory and CPU usage.
- **Configurable everything** — artists to save, scroll pages, retries, scroll
  speed, click/random delay ranges, headless mode, concurrent workers, max
  execution time, stop-after-failures and more, all validated with Zod.

## Architecture

Reverb uses a **modular, dependency-injected** architecture. Each feature is an
isolated service with a clean interface, wired together by a single composition
root ([`AppContainer`](src/core/AppContainer.ts)).

```
src/
├── shared/              # Types & defaults shared by main + renderer (no Node imports)
│   ├── types.ts         # Domain types + the IPC channel contract
│   └── defaults.ts      # Factory-default config & site selectors
├── core/                # The automation engine (runs in the Electron main process)
│   ├── AppContainer.ts  # Composition root (manual DI)
│   ├── config/          # ConfigManager + Zod schema (JSON config, validation)
│   ├── logging/         # Pino structured logger with in-memory ring buffer
│   ├── db/              # better-sqlite3 persistence (artists, sessions)
│   ├── browser/         # BrowserManager (Playwright persistent context)
│   ├── services/
│   │   ├── AuthService.ts        # Login-once + expiry detection
│   │   ├── NavigationService.ts  # Navigation w/ retry + refresh recovery
│   │   ├── LocationManager.ts    # Location selection (selector/search/URL)
│   │   ├── TrendingScanner.ts    # Scroll + scrape the trending grid
│   │   ├── LibraryManager.ts     # Save-to-library + verify
│   │   ├── UpdatesManager.ts     # Enable notifications + verify
│   │   ├── ArtistProcessor.ts    # Per-artist orchestration + retries
│   │   └── HumanBehavior.ts      # Randomised, human-like pacing/scrolling
│   ├── engine/          # AutomationEngine — run lifecycle & statistics
│   ├── reporting/       # ReportService (CSV/JSON/Excel + session reports)
│   ├── health/          # HealthMonitor (browser/db/network/cpu/memory)
│   └── utils/           # errors, async (retry/timeout/pool), validation, events
├── main/                # Electron main process
│   ├── index.ts         # Window lifecycle + teardown
│   └── ipc.ts           # Typed IPC handlers + event streaming
├── preload/             # contextBridge — the only surface the renderer can call
└── renderer/            # React dashboard (Vite)
    └── src/
        ├── App.tsx, hooks.ts, api.ts, styles.css
        └── components/  # Dashboard, Locations, Settings, Database, Logs
```

**Design principles**

- **Separation of concerns** — the renderer has zero Node access; all privileged
  work happens in the main process behind a typed IPC contract.
- **Single source of truth** — [`src/shared/types.ts`](src/shared/types.ts)
  defines the contract; Zod schemas validate it at runtime.
- **Recoverability first** — every network/DOM action goes through retry/refresh
  helpers; failures are recorded, not fatal.
- **Extensible** — add a new service, register an IPC channel, drop in a tab.

## Installation

**Prerequisites:** Node.js ≥ 20 (tested on Node 24), npm ≥ 10, and a supported
desktop OS (macOS or Windows).

```bash
# 1. Install dependencies. The postinstall step rebuilds the native SQLite
#    module for Electron and downloads the Chromium browser Playwright drives.
npm install

# 2. Launch in development (hot-reloaded renderer + main).
npm run dev
```

> **Launching from a terminal that sets `ELECTRON_RUN_AS_NODE=1`** (some IDE and
> agent shells do): unset it first, or Electron runs as plain Node and fails
> with `Cannot read properties of undefined (reading 'whenReady')`:
>
> ```bash
> env -u ELECTRON_RUN_AS_NODE npm run dev
> ```
>
> A normal app launch (double-click or a packaged build) is unaffected.

If the automatic Playwright download is skipped in your environment, run it
manually:

```bash
npx playwright install chromium
```

## Scripts

| Script                | Purpose                                                        |
| --------------------- | ------------------------------------------------------------- |
| `npm run dev`         | Run the app in development with hot reload                     |
| `npm run start`       | Preview the production build locally                          |
| `npm run build`       | Typecheck + build main / preload / renderer bundles           |
| `npm run typecheck`   | Strict TypeScript checks (node + web projects)               |
| `npm test`            | Run the Vitest unit suite once                               |
| `npm run test:watch`  | Run Vitest in watch mode                                      |
| `npm run lint`        | ESLint over `.ts` / `.tsx`                                     |
| `npm run format`      | Prettier formatting                                           |
| `npm run package`     | Build an unpacked app (no installer) into `release/`          |
| `npm run dist`        | Build platform installers (DMG/ZIP on macOS, NSIS on Windows) |
| `npm run dist:mac`    | Build macOS artifacts                                          |
| `npm run dist:win`    | Build Windows artifacts                                        |

## Configuration

Configuration is a plain JSON file you can edit by hand, stored in Electron's
`userData` directory:

- **macOS:** `~/Library/Application Support/Reverb/config.json`
- **Windows:** `%APPDATA%/Reverb/config.json`

It is created on first launch from defaults, validated with Zod on every load,
and merged over defaults if partial or edited. Key sections:

| Section        | Notable settings                                                                 |
| -------------- | -------------------------------------------------------------------------------- |
| `automation`   | `artistsToSave`, `maxScrollPages`, `maxRetries`, `clickDelay`, `randomDelay`, `headless`, `concurrentWorkers`, `maxExecutionTimeMs`, `stopAfterFailures`, `reportFormat` |
| `locations`    | saved trending locations + which is active + favorites                           |
| `paths`        | `databasePath`, `browserProfilePath`, `reportsPath`, `logsPath`                  |
| `site`         | ReverbNation base URL + all CSS selectors (see below)                            |

All of `automation` and the locations are editable from the desktop UI
(**Settings** and **Locations** tabs). Changes are validated and persisted
immediately.

## Usage

1. **Login** — click **Login**. A real browser window opens ReverbNation's login
   page; sign in normally. The session is persisted so you won't be asked again
   until it expires.
2. **Pick a location** — go to **Locations**, add or select a country/state/
   city/region, and mark favorites for quick switching. To visit several
   locations in one run, enable **“Cycle through multiple locations”** in
   Settings and tick the **In cycle** box for each location you want; the run
   visits them in the order you ticked them.
3. **Tune settings** — in **Settings**, set how many artists to save, whether to
   enable updates, pacing/delays, headless mode, etc. Click **Save Settings**.
4. **Start** — click **Start Automation**. Watch live progress on the
   **Dashboard** and streaming events under **Logs**.
5. **Pause / Resume / Stop** at any time from the top toolbar.
6. **Review & export** — the **Database** tab lists every processed artist with
   search and CSV/JSON/Excel export. A session report is written automatically
   when a run finishes (if enabled).

## Data & Reports

- **Database:** `…/Reverb/data/reverb.db` (SQLite, WAL mode).
- **Reports:** `…/Reverb/reports/` — `reverb-report-*.csv|json|xls` plus
  `session-*.json` summaries (start/end/duration, saved/failed/skipped, average
  processing time, full artist list).
- **Logs:** `…/Reverb/logs/reverb.log` (newline-delimited JSON via Pino).

## Site Selectors

Because a third-party site's markup changes over time, **all coupling to
ReverbNation lives in `config.site`** as CSS selectors — no code change is
needed to adapt. Each selector accepts multiple comma-separated candidates, and
the automation falls back gracefully. If saves or scans stop working, open
`config.json`, update the relevant `site.*` selector, and restart. Sensible
best-effort defaults ship in [`src/shared/defaults.ts`](src/shared/defaults.ts).

## Testing

Pure business logic is covered by a fast [Vitest](https://vitest.dev) suite
(no Electron, Playwright, DOM or filesystem required):

```bash
npm test
```

Covered today (`tests/`):

- **`async.test.ts`** — retry/backoff (`withRetry`), `withTimeout`, `randomInt`
  bounds, and bounded-concurrency `mapPool` (ordering, isolated rejections,
  concurrency cap).
- **`validation.test.ts`** — `artistIdFromUrl` across URL shapes, `isHttpUrl`,
  `clamp`, and the `requireString` / `requireNumber` guards.
- **`report-format.test.ts`** — CSV escaping/quoting, Excel (SpreadsheetML) XML
  escaping, and `averageProcessingMs`.

Report serialization lives in the pure module
[`src/core/reporting/format.ts`](src/core/reporting/format.ts) precisely so it
can be tested in isolation from the database — a template for how to keep new
logic testable.

## Extending Reverb

The architecture is built for growth without rework:

1. **New automation capability** — add a service under `src/core/services/`,
   construct it in [`AppContainer`](src/core/AppContainer.ts), and inject it.
2. **Expose it to the UI** — add a channel to `IpcChannels` in
   [`types.ts`](src/shared/types.ts), a handler in
   [`ipc.ts`](src/main/ipc.ts), and a method in the preload
   [`api`](src/preload/index.ts).
3. **New dashboard view** — drop a component in `renderer/src/components/` and a
   tab in [`App.tsx`](src/renderer/src/App.tsx).

## Troubleshooting

- **`better-sqlite3` errors on launch** — run `npm run postinstall` (or
  `npx electron-builder install-app-deps`) to rebuild the native module against
  your Electron version.
- **No browser opens / Playwright errors** — run `npx playwright install chromium`.
- **“Authentication required” at the start of every run** — your session
  expired; click **Login** again. Deleting the `browser-profile` folder forces a
  fresh login.
- **Scans find 0 artists / saves don't confirm** — ReverbNation markup likely
  changed; update the `site.*` selectors in `config.json`.

## License

MIT
