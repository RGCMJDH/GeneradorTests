import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { openStore } from '@core/store'
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
  /** Caché de OCR (userData/tessdata): en el smoke empieza vacía y tesseract.js la rellena al cargar los idiomas. */
  cacheDir: string
}

const UNPACKED = 'app.asar.unpacked'
const LANGS = ['spa', 'eng']

/**
 * Condiciones que la app EMPAQUETADA debe cumplir para que el smoke valga: recursos reales en app.asar.unpacked,
 * wasm cargado de verdad y datos de idioma incluidos (si no, el OCR caería en silencio al CDN y el smoke pasaría con internet).
 */
export function packagedProblems(env: SmokeEnv, wasmLoaded: boolean, exists: (p: string) => boolean = existsSync): string[] {
  if (!env.packaged) return []
  const problems: string[] = []
  if (!env.wasmDir.includes(UNPACKED)) problems.push(`wasmDir no está en ${UNPACKED}: ${env.wasmDir}`)
  if (!env.workerPath.includes(UNPACKED)) problems.push(`workerPath no está en ${UNPACKED}: ${env.workerPath}`)
  if (!wasmLoaded) problems.push('sql.js no pudo abrir una base de datos con el wasm de wasmDir')
  if (!env.langPath) problems.push('langPath sin definir: el OCR descargaría los idiomas del CDN en vez de usar los incluidos')
  else if (!exists(env.langPath)) problems.push(`langPath no existe en disco: ${env.langPath}`)
  return problems
}

/**
 * Tras el OCR, la caché de userData debe contener exactamente los idiomas incluidos (descomprimidos).
 * tesseract.js escribe la caché también cuando lee de un langPath local, así que «caché vacía» no sería una prueba válida;
 * la prueba es que estén spa y eng con el mismo contenido que resources/tessdata.
 */
export function cacheProblems(langPath: string, cacheDir: string): string[] {
  const problems: string[] = []
  for (const lang of LANGS) {
    const cached = join(cacheDir, `${lang}.traineddata`)
    if (!existsSync(cached)) {
      problems.push(`el OCR no dejó ${lang}.traineddata en la caché`)
      continue
    }
    try {
      const bundled = gunzipSync(readFileSync(join(langPath, `${lang}.traineddata.gz`)))
      if (!bundled.equals(readFileSync(cached))) problems.push(`${lang}.traineddata de la caché no coincide con el incluido`)
    } catch (e) {
      problems.push(`no se pudo comparar ${lang}: ${(e as Error).message}`)
    }
  }
  return problems
}

const traineddataIn = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.includes('.traineddata'))
  } catch {
    return []
  }
}

export async function runSmoke(win: BrowserWindow, dbPath: string, env: SmokeEnv): Promise<SmokeOutcome> {
  try {
    const problems: string[] = []
    // wasm real: abrir una base en memoria con exactamente la carpeta que usa la app (no un literal).
    const wasm = await openStore(undefined, { wasmDir: env.wasmDir }).then(
      () => true,
      () => false
    )
    problems.push(...packagedProblems(env, wasm))
    if (env.packaged && traineddataIn(env.cacheDir).length > 0) problems.push('la caché de OCR no estaba vacía antes del smoke')
    const page = (await win.webContents.executeJavaScript(PAGE_SCRIPT)) as PageResult
    if (env.packaged && env.langPath) problems.push(...cacheProblems(env.langPath, env.cacheDir))
    const result = {
      wasm,
      ...env,
      dbFileBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
      ...page
    }
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
