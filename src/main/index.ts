import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { openStore } from '@core/store'
import { OllamaProvider } from '@core/llm'
import type { OcrOptions } from '@core/ocr'
import { loadModel } from './config'
import { realCore, registerIpc, type DialogLike, type IpcContext } from './ipc'
import { isAllowedNavigation } from './navigation'
import { sqlWasmDir, tesseractWorkerPath } from './paths'
import { emit, fixtureDialog, runSmoke } from './smoke'

const SMOKE = process.env['GT_SMOKE'] === '1'
const SMOKE_TIMEOUT_MS = 100_000

// Antes de `ready`: el modo smoke usa un userData desechable y nunca toca los datos reales.
if (SMOKE) app.setPath('userData', join(tmpdir(), `gt-smoke-${process.pid}`))

const electronDialog: DialogLike = {
  showOpenDialog(opts) {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    return parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts)
  }
}

/**
 * OCR: en la app empaquetada el worker de Tesseract se ejecuta desde app.asar.unpacked y los idiomas (spa+eng)
 * vienen incluidos en resources/tessdata como .traineddata.gz (se copian a la caché de userData al usarse la primera vez).
 * En desarrollo no se fija nada: tesseract.js usa su worker y descarga los idiomas.
 */
function ocrBase(): OcrOptions {
  const bundled = join(process.resourcesPath, 'tessdata')
  return {
    workerPath: tesseractWorkerPath(),
    ...(app.isPackaged && ['spa', 'eng'].every((l) => existsSync(join(bundled, `${l}.traineddata.gz`))) ? { langPath: bundled } : {})
  }
}

async function createContext(dlg: DialogLike): Promise<{ ctx: IpcContext; dbPath: string }> {
  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  const model = loadModel(userDataDir)
  const dbPath = join(userDataDir, 'apuntes.sqlite')
  const store = await openStore(dbPath, { wasmDir: sqlWasmDir() })
  const ctx: IpcContext = {
    store,
    llm: new OllamaProvider({ model }),
    dialog: dlg,
    userDataDir,
    model,
    core: realCore,
    ocr: ocrBase()
  }
  return { ctx, dbPath }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: !SMOKE,
    title: 'Generador de tests',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // El renderer solo puede mostrar la propia app: sin ventanas nuevas ni navegación externa.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const indexPath = join(__dirname, '../renderer/index.html')
  const guard = { devUrl, indexUrl: pathToFileURL(indexPath).href }
  const deny = (e: { preventDefault(): void }, url: string): void => {
    if (!isAllowedNavigation(url, guard)) e.preventDefault()
  }
  win.webContents.on('will-navigate', (e, url) => deny(e, url))
  win.webContents.on('will-redirect', (e, url) => deny(e, url))

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(indexPath)
  return win
}

async function main(): Promise<void> {
  await app.whenReady()
  // Empaquetado, los fixtures del smoke van en resources/smoke-fixtures (extraResources); en desarrollo, tests/fixtures.
  const fixtures = app.isPackaged ? join(process.resourcesPath, 'smoke-fixtures') : join(app.getAppPath(), 'tests', 'fixtures')
  const { ctx, dbPath } = await createContext(SMOKE ? fixtureDialog(fixtures) : electronDialog)
  const ipc = registerIpc(ctx, ipcMain)
  // La subida desde el móvil abre un puerto en la red local: se cierra siempre al salir de la app.
  app.on('before-quit', () => {
    void ipc.dispose()
  })
  const win = createWindow()

  if (SMOKE) {
    const timer = setTimeout(() => void finishSmoke(false, 'GT_SMOKE_RESULT {"pass":false,"problems":["timeout"]}'), SMOKE_TIMEOUT_MS)
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    const res = await runSmoke(win, dbPath, { packaged: app.isPackaged, wasmDir: sqlWasmDir(), workerPath: ctx.ocr?.workerPath ?? '', langPath: ctx.ocr?.langPath })
    clearTimeout(timer)
    await finishSmoke(res.ok, res.line)
    return
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

async function finishSmoke(ok: boolean, line: string): Promise<void> {
  await emit(line)
  try {
    rmSync(app.getPath('userData'), { recursive: true, force: true })
  } catch {
    /* mejor esfuerzo */
  }
  app.exit(ok ? 0 : 1)
}

// Dos instancias pisarían el mismo apuntes.sqlite (sql.js guarda el archivo entero).
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main().catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e)
    if (SMOKE) await finishSmoke(false, `GT_SMOKE_RESULT ${JSON.stringify({ pass: false, problems: [msg] })}`)
    else {
      dialog.showErrorBox('No se pudo iniciar la aplicación', msg)
      app.exit(1)
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
