import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  IpcChannels,
  IpcEvents,
  type AppConfig,
  type ArtistQuery,
  type IpcResult,
  type ReportFormat,
  type TrendingLocation
} from '@shared/types'
import type { AppContainer } from '@core/AppContainer'
import { toMessage } from '@core/utils/errors'

export interface IpcDeps {
  /** Returns the CURRENT container (swapped when the profile switches). */
  getContainer: () => AppContainer
  getWindow: () => BrowserWindow | null
  /** Switch the active account profile (rebuilds the container). */
  activateProfile: (id: string) => Promise<void>
}

/** Send an event to the renderer window if present. */
function makeSend(getWindow: () => BrowserWindow | null) {
  return (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * Attach the container's event streams (status/log/health/artist) to the
 * renderer. Returns an unbind function. Called again whenever the active
 * profile switches and a new container is built.
 */
export function bindEvents(container: AppContainer, getWindow: () => BrowserWindow | null): () => void {
  const send = makeSend(getWindow)
  const offs = [
    container.engine.on('status', (s) => send(IpcEvents.status, s)),
    container.log.on('log', (entry) => send(IpcEvents.log, entry)),
    container.health.on('health', (h) => send(IpcEvents.health, h)),
    container.engine.onArtistUpdated((artistId) => send(IpcEvents.artistUpdated, container.db.getArtist(artistId)))
  ]
  return () => {
    for (const off of offs) off()
  }
}

/**
 * Register every IPC handler. Handlers read the CURRENT container via
 * `getContainer()` so they keep working across profile switches. Returns a
 * teardown that removes all handlers.
 */
export function registerIpc({ getContainer, getWindow, activateProfile }: IpcDeps): () => void {
  const send = makeSend(getWindow)

  const wrap =
    <T>(fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) =>
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<T>> => {
      try {
        return { ok: true, data: await fn(event, ...args) }
      } catch (err) {
        getContainer().log.error('ipc', `Handler error: ${toMessage(err)}`, { error: toMessage(err) })
        return { ok: false, error: toMessage(err) }
      }
    }

  const c = () => getContainer()

  /* ----------------------------- Config ------------------------------- */
  ipcMain.handle(IpcChannels.configGet, wrap(() => c().config.get()))
  ipcMain.handle(IpcChannels.configSave, wrap((_e, next) => c().config.save(next as AppConfig)))
  ipcMain.handle(IpcChannels.configReset, wrap(() => c().config.reset()))

  /* ---------------------------- Profiles ------------------------------ */
  ipcMain.handle(IpcChannels.profilesList, wrap(() => c().config.profilesInfo()))
  ipcMain.handle(IpcChannels.profileAdd, wrap((_e, name) => c().config.addProfile((name as string) ?? '')))
  ipcMain.handle(IpcChannels.profileRename, wrap((_e, id, name) => c().config.renameProfile(id as string, name as string)))
  ipcMain.handle(
    IpcChannels.profileRemove,
    wrap(async (_e, id) => {
      const wasActive = c().config.getActiveProfile().id === id
      c().config.removeProfile(id as string)
      if (wasActive) await activateProfile(c().config.getActiveProfile().id)
      return c().config.profilesInfo()
    })
  )
  ipcMain.handle(
    IpcChannels.profileSetActive,
    wrap(async (_e, id) => {
      await activateProfile(id as string)
      return c().config.profilesInfo()
    })
  )

  /* ---------------------------- Locations ----------------------------- */
  ipcMain.handle(IpcChannels.locationsList, wrap(() => c().config.listLocations()))
  ipcMain.handle(IpcChannels.locationAdd, wrap((_e, loc) => c().config.addLocation(loc as TrendingLocation)))
  ipcMain.handle(IpcChannels.locationRemove, wrap((_e, id) => c().config.removeLocation(id as string)))
  ipcMain.handle(IpcChannels.locationSetActive, wrap((_e, id) => c().config.setActiveLocation(id as string | null)))
  ipcMain.handle(IpcChannels.locationToggleFavorite, wrap((_e, id) => c().config.toggleFavorite(id as string)))
  ipcMain.handle(IpcChannels.locationSetCycle, wrap((_e, ids) => c().config.setCycleLocationIds((ids as string[]) ?? [])))
  ipcMain.handle(
    IpcChannels.locationAddByName,
    wrap(async (_e, query) => {
      const geo = await c().geocoding.geocode(query as string)
      const id = `loc-${geo.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`
      const location: TrendingLocation = {
        id,
        label: geo.label,
        type: 'custom',
        latitude: geo.latitude,
        longitude: geo.longitude,
        query: query as string
      }
      c().config.addLocation(location)
      return c().config.setActiveLocation(id)
    })
  )

  /* ------------------------------ Auth -------------------------------- */
  ipcMain.handle(
    IpcChannels.authLogin,
    wrap(async () => {
      const cfg = c().config.get()
      await c().browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: false })
      const status = await c().auth.openLoginWindow()
      c().engine.setAuthStatus(status)
      return status
    })
  )
  ipcMain.handle(
    IpcChannels.authCheck,
    wrap(async () => {
      const cfg = c().config.get()
      if (!c().browser.isReady()) {
        // Startup/switch verification is invisible (headless); Login is headed.
        await c().browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: true })
      }
      const status = await c().auth.checkAuthenticated()
      c().engine.setAuthStatus(status)
      return status
    })
  )

  /* ----------------------------- Engine ------------------------------- */
  ipcMain.handle(IpcChannels.engineStart, wrap(() => c().engine.start()))
  ipcMain.handle(IpcChannels.enginePause, wrap(() => c().engine.pause()))
  ipcMain.handle(IpcChannels.engineResume, wrap(() => c().engine.resume()))
  ipcMain.handle(IpcChannels.engineStop, wrap(() => c().engine.stop()))
  ipcMain.handle(
    IpcChannels.engineTestConnection,
    wrap(async () => {
      const cfg = c().config.get()
      if (!c().browser.isReady()) {
        await c().browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: true })
      }
      const page = await c().browser.getPage()
      const resp = await page.goto(cfg.site.baseUrl, { waitUntil: 'domcontentloaded' })
      const online = !!resp && resp.status() < 400
      c().health.setNetworkStatus(online ? 'online' : 'degraded')
      return { online, status: resp?.status() ?? 0 }
    })
  )

  /* ---------------------------- Database ------------------------------ */
  ipcMain.handle(IpcChannels.dbQuery, wrap((_e, q) => c().db.query((q as ArtistQuery) ?? {})))
  ipcMain.handle(IpcChannels.dbStats, wrap(() => c().db.stats()))
  ipcMain.handle(IpcChannels.dbDelete, wrap((_e, id) => c().db.deleteArtist(id as string)))
  ipcMain.handle(IpcChannels.dbClear, wrap(() => c().db.clearAll()))
  ipcMain.handle(
    IpcChannels.dbExport,
    wrap((_e, format) => {
      const path = c().report.export((format as ReportFormat) ?? 'csv')
      void shell.showItemInFolder(path)
      return path
    })
  )

  /* ------------------------- Reports / Logs --------------------------- */
  ipcMain.handle(
    IpcChannels.reportExport,
    wrap((_e, format) => {
      const path = c().report.export((format as ReportFormat) ?? 'csv')
      void shell.showItemInFolder(path)
      return path
    })
  )
  ipcMain.handle(
    IpcChannels.logsExport,
    wrap(async () => {
      const win = getWindow()
      const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
        title: 'Export Logs',
        defaultPath: `reverb-logs-${Date.now()}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || !filePath) return null
      const { writeFileSync } = await import('node:fs')
      writeFileSync(filePath, JSON.stringify(c().log.recent(1000), null, 2), 'utf-8')
      return filePath
    })
  )

  /* ---------------------------- Health -------------------------------- */
  ipcMain.handle(IpcChannels.healthGet, wrap(() => c().health.sample()))

  // Nudge the renderer with a fresh status after (re)registering.
  send(IpcEvents.status, getContainer().engine.getStatus())

  return () => {
    for (const channel of Object.values(IpcChannels)) ipcMain.removeHandler(channel)
  }
}
