import { existsSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { DialogLike } from './ipc'

/** Diálogo falso para el modo smoke: elige un fixture según el filtro de extensión pedido. */
export function fixtureDialog(fixturesDir: string): DialogLike {
  return {
    async showOpenDialog(opts) {
      const ext = opts.filters[0]?.extensions[0]
      const file =
        ext === 'pdf' ? (process.env['GT_SMOKE_PDF'] ?? 'apuntes.pdf') : ext === 'png' ? 'foto-apuntes.png' : 'apuntes-ejemplo.md'
      return { canceled: false, filePaths: [join(fixturesDir, file)] }
    }
  }
}

/** Se ejecuta DENTRO de la página oculta: usa window.api real (preload → ipcRenderer → ipcMain → core). */
const PAGE_SCRIPT = `(async () => {
  const api = window.api
  const out = { hasApi: typeof api === 'object' && api !== null, exposesIpcRenderer: 'ipcRenderer' in window || 'require' in window }
  out.methods = Object.fromEntries(Object.entries(api).map(([k, v]) => [k, Object.keys(v)]))
  const created = await api.subjects.create('Smoke')
  const list = await api.subjects.list()
  const id = created.ok ? created.data.id : -1
  const text = await api.notes.import(id, 'text')
  const pdf = await api.notes.import(id, 'pdf')
  const image = await api.notes.import(id, 'image')
  const health = await api.system.health()
  const bad = await api.subjects.create('')
  out.created = created.ok
  out.subjects = list.ok ? list.data.length : -1
  out.textChunks = text.ok && !text.data.canceled ? text.data.document.chunkCount : -1
  out.pdfResult = pdf.ok ? 'ok' : pdf.code
  out.pdfChunks = pdf.ok && !pdf.data.canceled ? pdf.data.document.chunkCount : -1
  out.imageResult = image.ok ? 'ok' : image.code + ': ' + image.error
  out.ocrText = image.ok && !image.data.canceled && image.data.kind === 'image' ? image.data.ocrText.slice(0, 120) : ''
  out.health = health.ok ? health.data : { error: health.error }
  out.invalidCode = bad.ok ? 'none' : bad.code
  const unsub = api.quiz.onProgress(() => {})
  out.unsubscribeIsFunction = typeof unsub === 'function'
  unsub()
  return out
})()`

interface PageResult {
  hasApi: boolean
  exposesIpcRenderer: boolean
  subjects: number
  textChunks: number
  pdfResult: string
  pdfChunks: number
  imageResult: string
  ocrText: string
  invalidCode: string
  health: { ok?: boolean; message?: string; error?: string }
}

export interface SmokeOutcome {
  ok: boolean
  line: string
}

/** Datos del entorno que el smoke imprime para demostrar de dónde se cargó cada recurso. */
export interface SmokeEnv {
  packaged: boolean
  wasmDir: string
  workerPath: string
  langPath: string | undefined
}

export async function runSmoke(win: BrowserWindow, dbPath: string, env: SmokeEnv): Promise<SmokeOutcome> {
  try {
    const page = (await win.webContents.executeJavaScript(PAGE_SCRIPT)) as PageResult
    const result = {
      wasm: true, // openStore ya resolvió: sql-wasm.wasm cargado desde env.wasmDir
      ...env,
      dbFileBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
      ...page
    }
    const problems: string[] = []
    if (!result.hasApi) problems.push('window.api no existe (preload no cargado)')
    if (result.exposesIpcRenderer) problems.push('el renderer ve ipcRenderer/require')
    if (result.subjects !== 1) problems.push(`subjects=${String(result.subjects)}`)
    if (!(Number(result.textChunks) > 0)) problems.push('la importación de texto no creó chunks')
    if (!(Number(result.pdfChunks) > 0)) problems.push(`importación de PDF: ${String(result.pdfResult)}`)
    if (!result.ocrText.toLowerCase().includes('mitocondria')) problems.push(`OCR: ${String(result.imageResult)} «${result.ocrText}»`)
    if (result.invalidCode !== 'INVALID') problems.push('la validación no rechazó un nombre vacío')
    if (result.dbFileBytes <= 0) problems.push('apuntes.sqlite no se escribió')
    if (typeof result.health.message !== 'string') problems.push('health sin mensaje')
    const line = `GT_SMOKE_RESULT ${JSON.stringify({ pass: problems.length === 0, problems, ...result })}`
    return { ok: problems.length === 0, line }
  } catch (e) {
    return { ok: false, line: `GT_SMOKE_RESULT ${JSON.stringify({ pass: false, problems: [(e as Error).message] })}` }
  }
}

/** GT_SMOKE_OUT solo puede apuntar dentro de la carpeta temporal del sistema (nunca a rutas arbitrarias). */
export function isInsideTmp(path: string): boolean {
  const rel = relative(resolve(tmpdir()), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Escribe la línea en stdout y, si GT_SMOKE_OUT está definido (y dentro de os.tmpdir()), también en ese archivo (útil si el stdout no se captura). */
export function emit(line: string): Promise<void> {
  const out = process.env['GT_SMOKE_OUT']
  if (out && isInsideTmp(out)) {
    try {
      writeFileSync(out, line + '\n')
    } catch {
      /* mejor esfuerzo */
    }
  }
  return new Promise((resolve) => process.stdout.write(line + '\n', () => resolve()))
}
