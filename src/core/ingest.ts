import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { PDFParse } from 'pdf-parse'
import { chunkText } from './chunker'
import { ocrImage, type OcrOptions } from './ocr'
import type { Store } from './store'
import type { Chunk, Doc } from './types'

export interface IngestDeps {
  store: Store
}

export interface IngestResult {
  document: Doc
  chunks: Chunk[]
  /** Aviso para el usuario (p. ej. archivo vacío); el documento sí se crea. */
  warning?: string
}

/** El PDF no contiene texto extraíble (probablemente escaneado): la UI puede ofrecer OCR. */
export class NoTextError extends Error {
  constructor(message = 'El PDF no contiene texto seleccionable (parece escaneado). Prueba con OCR.') {
    super(message)
    this.name = 'NoTextError'
  }
}

const titleOf = (filePath: string): string => basename(filePath, extname(filePath))

async function readBytes(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    const why = code === 'ENOENT' ? 'el archivo no existe' : code === 'EISDIR' ? 'es una carpeta, no un archivo' : (e as Error).message
    throw new Error(`No se pudo leer «${basename(filePath)}»: ${why}.`)
  }
}

function saveDocument(
  deps: IngestDeps,
  subjectId: number,
  filePath: string,
  sourceType: Doc['sourceType'],
  text: string
): IngestResult {
  const document = deps.store.addDocument({ subjectId, title: titleOf(filePath), sourceType, path: filePath })
  const pieces = chunkText(text)
  if (pieces.length === 0) {
    return {
      document,
      chunks: [],
      warning: `El archivo «${basename(filePath)}» está vacío: no se generó ningún fragmento.`
    }
  }
  return { document, chunks: deps.store.addChunks(document.id, subjectId, pieces) }
}

export async function importTextFile(deps: IngestDeps, subjectId: number, filePath: string): Promise<IngestResult> {
  const bytes = await readBytes(filePath)
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return saveDocument(deps, subjectId, filePath, 'text', text)
}

export async function importPdf(deps: IngestDeps, subjectId: number, filePath: string): Promise<IngestResult> {
  const bytes = await readBytes(filePath)
  let text: string
  const parser = new PDFParse({ data: new Uint8Array(bytes) })
  try {
    // Se unen las páginas a mano: `result.text` añade marcadores «-- 1 of N --» que no son contenido.
    text = (await parser.getText()).pages.map((pg) => pg.text.trim()).filter(Boolean).join('\n\n')
  } catch (e) {
    throw new Error(`No se pudo leer el PDF «${basename(filePath)}»: ${(e as Error).message}`)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
  text = text.replace(/\r\n?/g, '\n')
  // Se comprueba ANTES de crear el documento para no dejar filas huérfanas.
  if (text.trim().length === 0) throw new NoTextError()
  return saveDocument(deps, subjectId, filePath, 'pdf', text)
}

export interface ImageImportResult {
  document: Doc
  /** Texto reconocido tal cual; el usuario lo revisa y lo confirma con `confirmOcr`. Puede ser ''. */
  ocrText: string
}

/**
 * Hace OCR de una foto y crea el documento, pero NO crea chunks: el texto de un OCR casi siempre
 * necesita revisión humana antes de usarlo para generar preguntas (ver `confirmOcr`).
 */
export async function importImage(
  deps: IngestDeps,
  subjectId: number,
  filePath: string,
  opts?: OcrOptions
): Promise<ImageImportResult> {
  // El OCR va ANTES de crear el documento: si falla no queda ninguna fila huérfana.
  const ocrText = await ocrImage(filePath, opts)
  const document = deps.store.addDocument({ subjectId, title: titleOf(filePath), sourceType: 'image', path: filePath })
  return { document, ocrText }
}

/** Trocea el texto corregido por el usuario y lo guarda; reemplaza lo confirmado antes para ese documento. */
export function confirmOcr(deps: IngestDeps, documentId: number, correctedText: string): Chunk[] {
  const document = deps.store.getDocument(documentId)
  if (!document) throw new Error(`El documento ${documentId} no existe.`)
  if (document.sourceType !== 'image')
    throw new Error(`El documento «${document.title}» no es una imagen: no se puede confirmar como OCR.`)
  const pieces = chunkText(correctedText.replace(/\r\n?/g, '\n'))
  deps.store.deleteChunks(documentId)
  if (pieces.length === 0) return []
  return deps.store.addChunks(documentId, document.subjectId, pieces)
}
