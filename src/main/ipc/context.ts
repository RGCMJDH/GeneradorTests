import type { Store } from '@core/store'
import type { LlmProvider } from '@core/llm'
import { importTextFile, importPdf, importImage, confirmOcr } from '@core/ingest'
import { generateQuestions } from '@core/generate'
import { gradeAnswer } from '@core/grade'
import { extractConcepts } from '@core/graph'
import type { UploadServer, UploadServerOptions } from '@core/mobile'

/** Funciones del core que usan los handlers; inyectables para probar sin LLM/OCR reales. */
export interface CoreFns {
  importTextFile: typeof importTextFile
  importPdf: typeof importPdf
  importImage: typeof importImage
  confirmOcr: typeof confirmOcr
  generateQuestions: typeof generateQuestions
  gradeAnswer: typeof gradeAnswer
  extractConcepts: typeof extractConcepts
}

export const realCore: CoreFns = { importTextFile, importPdf, importImage, confirmOcr, generateQuestions, gradeAnswer, extractConcepts }

/** Subconjunto de `dialog.showOpenDialog` de Electron. Solo vive en main. */
export interface DialogLike {
  showOpenDialog(opts: {
    title?: string
    properties: Array<'openFile'>
    filters: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface SenderLike {
  send(channel: string, ...args: unknown[]): void
  isDestroyed?(): boolean
  /** webContents: sirve para parar la subida móvil si la ventana se destruye o recarga. */
  once?(event: string, cb: () => void): unknown
  on?(event: string, cb: () => void): unknown
  removeListener?(event: string, cb: () => void): unknown
}

export interface IpcEventLike {
  sender: SenderLike
}

export type Listener = (event: IpcEventLike, ...args: unknown[]) => unknown

/** Subconjunto de `ipcMain` (inyectable: los tests pasan un registrador falso). */
export interface Registrar {
  handle(channel: string, listener: Listener): void
}

/** Servidor de subida y generador del QR; inyectables para probar sin abrir puertos. */
export interface MobileDeps {
  startUploadServer(opts: UploadServerOptions): Promise<UploadServer>
  qrDataUrl(url: string): Promise<string>
}

export interface IpcContext {
  store: Store
  llm: LlmProvider
  dialog: DialogLike
  /** app.getPath('userData'). De aquí cuelga tessdata. */
  userDataDir: string
  /** Modelo configurado (el mismo con el que se construyó `llm`). */
  model: string
  core: CoreFns
  /** Por defecto el servidor real y `qrcode`. */
  mobile?: MobileDeps
  /** Tope duro de system:health aunque el proveedor no responda (por defecto 5000). */
  healthTimeoutMs?: number
}
