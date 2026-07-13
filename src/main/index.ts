import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { AppContainer } from '@core/AppContainer'
import { registerIpc } from './ipc'

/**
 * Electron main entrypoint. Owns the window lifecycle, constructs the single
 * AppContainer, wires IPC, and guarantees graceful teardown of the browser,
 * database and logger on quit.
 */

let mainWindow: BrowserWindow | null = null
let container: AppContainer | null = null
let disposeIpc: (() => void) | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0b0e14',
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
  container = new AppContainer(app.getPath('userData'))
  disposeIpc = registerIpc(container, () => mainWindow)

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
