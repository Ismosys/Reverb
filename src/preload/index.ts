import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  IpcEvents,
  type AppConfig,
  type ArtistQuery,
  type ArtistRecord,
  type AuthStatus,
  type HealthSnapshot,
  type IpcResult,
  type LogEntry,
  type ReportFormat,
  type RunStatus,
  type TrendingLocation
} from '@shared/types'

/**
 * The single, typed IPC surface exposed to the renderer via contextBridge.
 * The renderer has no Node access — everything flows through `window.reverb`.
 */
const api = {
  config: {
    get: (): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.configGet),
    save: (config: AppConfig): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.configSave, config),
    reset: (): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.configReset)
  },
  locations: {
    list: (): Promise<IpcResult<TrendingLocation[]>> => ipcRenderer.invoke(IpcChannels.locationsList),
    add: (loc: TrendingLocation): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.locationAdd, loc),
    remove: (id: string): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.locationRemove, id),
    setActive: (id: string | null): Promise<IpcResult<AppConfig>> =>
      ipcRenderer.invoke(IpcChannels.locationSetActive, id),
    toggleFavorite: (id: string): Promise<IpcResult<AppConfig>> =>
      ipcRenderer.invoke(IpcChannels.locationToggleFavorite, id),
    setCycle: (ids: string[]): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.locationSetCycle, ids),
    addByName: (query: string): Promise<IpcResult<AppConfig>> =>
      ipcRenderer.invoke(IpcChannels.locationAddByName, query)
  },
  auth: {
    login: (): Promise<IpcResult<AuthStatus>> => ipcRenderer.invoke(IpcChannels.authLogin),
    check: (): Promise<IpcResult<AuthStatus>> => ipcRenderer.invoke(IpcChannels.authCheck)
  },
  engine: {
    start: (): Promise<IpcResult<RunStatus>> => ipcRenderer.invoke(IpcChannels.engineStart),
    pause: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IpcChannels.enginePause),
    resume: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IpcChannels.engineResume),
    stop: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IpcChannels.engineStop),
    testConnection: (): Promise<IpcResult<{ online: boolean; status: number }>> =>
      ipcRenderer.invoke(IpcChannels.engineTestConnection)
  },
  db: {
    query: (q: ArtistQuery): Promise<IpcResult<ArtistRecord[]>> => ipcRenderer.invoke(IpcChannels.dbQuery, q),
    remove: (id: string): Promise<IpcResult<boolean>> => ipcRenderer.invoke(IpcChannels.dbDelete, id),
    clear: (): Promise<IpcResult<number>> => ipcRenderer.invoke(IpcChannels.dbClear),
    export: (format: ReportFormat): Promise<IpcResult<string>> => ipcRenderer.invoke(IpcChannels.dbExport, format)
  },
  report: {
    export: (format: ReportFormat): Promise<IpcResult<string>> => ipcRenderer.invoke(IpcChannels.reportExport, format)
  },
  logs: {
    export: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(IpcChannels.logsExport)
  },
  health: {
    get: (): Promise<IpcResult<HealthSnapshot>> => ipcRenderer.invoke(IpcChannels.healthGet)
  },
  /** Subscribe to pushed events. Each returns an unsubscribe function. */
  on: {
    status: (cb: (s: RunStatus) => void) => subscribe(IpcEvents.status, cb),
    log: (cb: (e: LogEntry) => void) => subscribe(IpcEvents.log, cb),
    health: (cb: (h: HealthSnapshot) => void) => subscribe(IpcEvents.health, cb),
    artistUpdated: (cb: (a: ArtistRecord | null) => void) => subscribe(IpcEvents.artistUpdated, cb)
  }
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export type ReverbApi = typeof api

contextBridge.exposeInMainWorld('reverb', api)
