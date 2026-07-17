import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { AppContainer } from '@core/AppContainer'
import { bindEvents, registerIpc } from './ipc'
// Bundled by electron-vite; resolves to a real path in dev and packaged builds.
import appIconPath from '../../build/icon.png?asset'

const appIcon = nativeImage.createFromPath(appIconPath)

/**
 * Electron main entrypoint. Owns the window lifecycle and the app container.
 *
 * The container is rebuilt when the active account profile switches (each
 * profile has isolated browser session + data). IPC handlers reference the
 * current container via an accessor, and event forwarders are re-bound on each
 * rebuild, so switching accounts is transparent to the renderer.
 */

let mainWindow: BrowserWindow | null = null
let container: AppContainer | null = null
let unbindEvents: (() => void) | null = null
let disposeIpc: (() => void) | null = null
let userDataDir = ''

/** Swap to a different account profile: stop, tear down, rebuild, re-bind. */
async function activateProfile(profileId: string): Promise<void> {
  if (!container) return
  const old = container
  try {
    old.engine.stop()
  } catch {
    /* ignore */
  }
  old.config.setActiveProfile(profileId)

  // Build the new container (reads the updated active profile from config).
  const next = new AppContainer(userDataDir)
  container = next
  unbindEvents?.()
  unbindEvents = bindEvents(next, () => mainWindow)

  await old.dispose().catch(() => undefined)

  // Push a fresh snapshot for the newly-active account.
  const win = mainWindow
  if (win && !win.isDestroyed()) {
    win.webContents.send('evt:status', next.engine.getStatus())
    win.webContents.send('evt:health', next.health.sample())
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0e14',
    icon: appIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Open external links in the user's default browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) {
    void mainWindow.loadURL(devServer)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.reverb.automation')
  // Dock icon for unpackaged (dev) runs; packaged builds use the bundle icns.
  if (process.platform === 'darwin' && app.dock && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon)
  }
  userDataDir = app.getPath('userData')
  container = new AppContainer(userDataDir)
  unbindEvents = bindEvents(container, () => mainWindow)
  disposeIpc = registerIpc({
    getContainer: () => {
      if (!container) throw new Error('App not initialized')
      return container
    },
    getWindow: () => mainWindow,
    activateProfile
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  if (!container) return
  event.preventDefault()
  disposeIpc?.()
  unbindEvents?.()
  const c = container
  container = null
  await c.dispose().catch(() => undefined)
  app.exit(0)
})

// Never crash the whole process on an unhandled rejection in a service.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason)
})
