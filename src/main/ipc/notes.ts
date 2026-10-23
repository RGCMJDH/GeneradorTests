import { join } from 'node:path'
import type { OcrOptions } from '@core/ocr'
import type { Doc } from '@core/types'
import { NoTextError } from '@core/ingest'
import { channels, type ChunkView, type ConfirmOcrOutcome, type DocumentInfo, type ImportKind, type ImportOutcome } from '../../shared/api'
import { handle, invalid, IpcError, notFound } from './common'
import type { IpcContext, Registrar } from './context'
import { requireSubject } from './subjects'
import { arity, id, MAX_NOTES_TEXT, oneOf, optId, str } from './validate'

const KINDS = ['text', 'pdf', 'image'] as const

const DIALOGS: Record<ImportKind, { title: string; filters: Array<{ name: string; extensions: string[] }> }> = {
  text: { title: 'Importar apuntes de texto', filters: [{ name: 'Texto', extensions: ['txt', 'md', 'markdown'] }] },
  pdf: { title: 'Importar PDF', filters: [{ name: 'PDF', extensions: ['pdf'] }] },
  image: {
    title: 'Importar foto de apuntes',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] }]
  }
}

/** Primera ejecución: Tesseract descarga ~20 MB de datos de idioma, de ahí el margen de 5 min. */
const OCR_LOAD_TIMEOUT_MS = 300_000

const ocrOptions = (ctx: IpcContext): OcrOptions => ({
  ...ctx.ocr,
  cachePath: join(ctx.userDataDir, 'tessdata'),
  timeoutMs: OCR_LOAD_TIMEOUT_MS
})

const toInfo = (ctx: IpcContext, d: Doc): DocumentInfo => ({
  id: d.id,
  subjectId: d.subjectId,
  title: d.title,
  sourceType: d.sourceType,
  chunkCount: ctx.store.listChunks(d.subjectId, d.id).length
})

/**
 * OCR de una imagen ya localizada por main (diálogo nativo o subida móvil de la Tarea 14).
 * Crea el documento sin chunks; el usuario revisa `ocrText` y lo confirma con notes:confirmOcr.
 */
export async function ingestImageFromPath(
  ctx: IpcContext,
  subjectId: number,
  path: string
): Promise<{ documentId: number; ocrText: string }> {
  requireSubject(ctx, subjectId)
  const { document, ocrText } = await ctx.core.importImage({ store: ctx.store }, subjectId, path, ocrOptions(ctx))
  return { documentId: document.id, ocrText }
}

async function importFromDialog(ctx: IpcContext, subjectId: number, kind: ImportKind): Promise<ImportOutcome> {
  requireSubject(ctx, subjectId)
  const d = DIALOGS[kind]
  const picked = await ctx.dialog.showOpenDialog({ title: d.title, properties: ['openFile'], filters: d.filters })
  const path = picked.filePaths[0]
  if (picked.canceled || path === undefined) return { canceled: true }

  if (kind === 'image') return { canceled: false, kind, ...(await ingestImageFromPath(ctx, subjectId, path)) }
  try {
    const run = kind === 'pdf' ? ctx.core.importPdf : ctx.core.importTextFile
    const res = await run({ store: ctx.store }, subjectId, path)
    return {
      canceled: false,
      kind,
      document: toInfo(ctx, res.document),
      ...(res.warning ? { warning: res.warning } : {})
    }
  } catch (e) {
    if (e instanceof NoTextError) throw new IpcError(e.message, 'NO_TEXT')
    throw e
  }
}

export function registerNotes(ctx: IpcContext, r: Registrar): void {
  const { store } = ctx

  handle(r, channels.notesImport, (_e, args) => {
    arity(args, 2)
    return importFromDialog(ctx, id(args[0], 'subjectId'), oneOf(args[1], KINDS, 'El tipo de importación'))
  })

  handle(r, channels.notesConfirmOcr, (_e, args): ConfirmOcrOutcome => {
    arity(args, 2, 3)
    const documentId = id(args[0], 'documentId')
    const text = str(args[1], 'El texto', MAX_NOTES_TEXT, { allowEmpty: true })
    if (args[2] !== undefined && typeof args[2] !== 'boolean') throw invalid('force debe ser booleano.')
    const force = args[2] === true

    const doc = store.getDocument(documentId)
    if (!doc) throw notFound(`El documento ${documentId} no existe.`)
    if (doc.sourceType !== 'image') throw invalid(`«${doc.title}» no es una imagen: no se puede confirmar como OCR.`)

    // confirmOcr reemplaza los chunks y las preguntas caen en cascada: se avisa antes de perderlas.
    const chunkIds = new Set(store.listChunks(doc.subjectId, doc.id).map((c) => c.id))
    const count = store.listQuestions(doc.subjectId).filter((q) => chunkIds.has(q.chunkId)).length
    if (count > 0 && !force) {
      throw new IpcError(
        `Confirmar este texto borraría ${count} pregunta${count === 1 ? '' : 's'} ya generada${count === 1 ? '' : 's'} a partir de este documento.`,
        'WOULD_DELETE_QUESTIONS',
        { count }
      )
    }
    const chunks = ctx.core.confirmOcr({ store }, documentId, text)
    return { documentId, chunkCount: chunks.length, deletedQuestions: count }
  })

  handle(r, channels.notesList, (_e, args): DocumentInfo[] => {
    arity(args, 1)
    return store.listDocuments(id(args[0], 'subjectId')).map((d) => toInfo(ctx, d))
  })

  handle(r, channels.notesChunks, (_e, args) => {
    arity(args, 1, 2)
    return store.listChunks(id(args[0], 'subjectId'), optId(args[1], 'documentId'))
  })

  handle(r, channels.notesChunk, (_e, args): ChunkView => {
    arity(args, 2)
    const subjectId = id(args[0], 'subjectId')
    const chunk = store.getChunk(id(args[1], 'chunkId'))
    const doc = chunk && chunk.subjectId === subjectId ? store.getDocument(chunk.documentId) : undefined
    if (!chunk || !doc) throw notFound('El fragmento no existe en esta asignatura.')
    return { id: chunk.id, documentId: doc.id, documentTitle: doc.title, position: chunk.position, text: chunk.text }
  })

  handle(r, channels.notesDeleteDocument, (_e, args) => {
    arity(args, 2)
    const subjectId = id(args[0], 'subjectId')
    const documentId = id(args[1], 'documentId')
    if (store.getDocument(documentId)?.subjectId !== subjectId) throw notFound('El documento no existe en esta asignatura.')
    store.deleteDocument(documentId)
    return null
  })
}
