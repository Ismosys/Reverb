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

/**
 * Registers every IPC handler and streams engine/log/health events to the
 * renderer window. Each handler is wrapped so it always returns an
 * `IpcResult<T>` envelope — the renderer never sees an unhandled rejection.
 */
export function registerIpc(container: AppContainer, getWindow: () => BrowserWindow | null): () => void {
  const { engine, config, db, auth, log, health, report } = container

  const wrap =
    <T>(fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T) =>
    async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<IpcResult<T>> => {
      try {
        return { ok: true, data: await fn(event, ...args) }
      } catch (err) {
        log.error('ipc', `Handler error: ${toMessage(err)}`, { error: toMessage(err) })
        return { ok: false, error: toMessage(err) }
      }
    }

  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  /* -------------------- Event forwarding to renderer ------------------- */
  const unsubscribers: Array<() => void> = []
  unsubscribers.push(engine.on('status', (s) => send(IpcEvents.status, s)))
  unsubscribers.push(log.on('log', (entry) => send(IpcEvents.log, entry)))
  unsubscribers.push(health.on('health', (h) => send(IpcEvents.health, h)))
  unsubscribers.push(
    engine.onArtistUpdated((artistId) => send(IpcEvents.artistUpdated, db.getArtist(artistId)))
  )

  /* ----------------------------- Config ------------------------------- */
  ipcMain.handle(IpcChannels.configGet, wrap(() => config.get()))
  ipcMain.handle(IpcChannels.configSave, wrap((_e, next) => config.save(next as AppConfig)))
  ipcMain.handle(IpcChannels.configReset, wrap(() => config.reset()))

  /* ---------------------------- Locations ----------------------------- */
  ipcMain.handle(IpcChannels.locationsList, wrap(() => config.listLocations()))
  ipcMain.handle(IpcChannels.locationAdd, wrap((_e, loc) => config.addLocation(loc as TrendingLocation)))
  ipcMain.handle(IpcChannels.locationRemove, wrap((_e, id) => config.removeLocation(id as string)))
  ipcMain.handle(IpcChannels.locationSetActive, wrap((_e, id) => config.setActiveLocation(id as string | null)))
  ipcMain.handle(IpcChannels.locationToggleFavorite, wrap((_e, id) => config.toggleFavorite(id as string)))
  ipcMain.handle(IpcChannels.locationSetCycle, wrap((_e, ids) => config.setCycleLocationIds((ids as string[]) ?? [])))

  /* ------------------------------ Auth -------------------------------- */
  ipcMain.handle(
    IpcChannels.authLogin,
    wrap(async () => {
      const cfg = config.get()
      // Login must be interactive → force a visible window regardless of headless.
      await container.browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: false })
      return auth.openLoginWindow()
    })
  )
  ipcMain.handle(
    IpcChannels.authCheck,
    wrap(async () => {
      const cfg = config.get()
      if (!container.browser.isReady()) {
        await container.browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: cfg.automation.headless })
      }
      return auth.checkAuthenticated()
    })
  )

  /* ----------------------------- Engine ------------------------------- */
  ipcMain.handle(IpcChannels.engineStart, wrap(() => engine.start()))
  ipcMain.handle(IpcChannels.enginePause, wrap(() => engine.pause()))
  ipcMain.handle(IpcChannels.engineResume, wrap(() => engine.resume()))
  ipcMain.handle(IpcChannels.engineStop, wrap(() => engine.stop()))
  ipcMain.handle(
    IpcChannels.engineTestConnection,
    wrap(async () => {
      const cfg = config.get()
      if (!container.browser.isReady()) {
        await container.browser.launch({ profilePath: cfg.paths.browserProfilePath, headless: true })
      }
      const page = await container.browser.getPage()
      const resp = await page.goto(cfg.site.baseUrl, { waitUntil: 'domcontentloaded' })
      const online = !!resp && resp.status() < 400
      health.setNetworkStatus(online ? 'online' : 'degraded')
      return { online, status: resp?.status() ?? 0 }
    })
  )

  /* ---------------------------- Database ------------------------------ */
  ipcMain.handle(IpcChannels.dbQuery, wrap((_e, q) => db.query((q as ArtistQuery) ?? {})))
  ipcMain.handle(IpcChannels.dbDelete, wrap((_e, id) => db.deleteArtist(id as string)))
  ipcMain.handle(IpcChannels.dbClear, wrap(() => db.clearAll()))
  ipcMain.handle(
    IpcChannels.dbExport,
    wrap((_e, format) => {
      const path = report.export((format as ReportFormat) ?? 'csv')
      void shell.showItemInFolder(path)
      return path
    })
  )

  /* ------------------------- Reports / Logs --------------------------- */
  ipcMain.handle(
    IpcChannels.reportExport,
    wrap((_e, format) => {
      const path = report.export((format as ReportFormat) ?? 'csv')
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
      writeFileSync(filePath, JSON.stringify(log.recent(1000), null, 2), 'utf-8')
      return filePath
    })
  )

  /* ---------------------------- Health -------------------------------- */
  ipcMain.handle(IpcChannels.healthGet, wrap(() => health.sample()))

  // Teardown: remove handlers + event forwarders.
  return () => {
    for (const off of unsubscribers) off()
    for (const channel of Object.values(IpcChannels)) ipcMain.removeHandler(channel)
  }
}
