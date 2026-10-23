import { mergeConcepts } from '@core/conceptMerge'
import { MAX_CONCEPT_CHUNKS } from '@core/graph'
import { StaleConceptsError } from '@core/store'
import { channels, events, type Concept, type ConceptsOutcome, type ProgressEvent } from '../../shared/api'
import { handle, invalid, IpcError, notFound, trySend } from './common'
import type { IpcContext, Registrar } from './context'
import { requireSubject } from './subjects'
import { arity, id, optId, record, requestId } from './validate'

const BUILD_KEYS = ['requestId', 'subjectId', 'documentId'] as const
const MODEL_DOWN = 'No se pudieron extraer conceptos: el modelo no respondió. Comprueba que Ollama está en marcha.'
const STALE = 'Los apuntes cambiaron durante la extracción; vuelve a intentarlo.'

export function registerConcepts(ctx: IpcContext, r: Registrar): void {
  const { store } = ctx
  /** Extracciones en curso, por requestId del renderer. */
  const running = new Map<string, AbortController>()
  /** Asignaturas con una extracción en curso: dos a la vez solo gastarían CPU y se pisarían al guardar. */
  const busy = new Set<number>()

  /**
   * Guarda el resultado; devuelve el índice resultante. Lanza STALE si los apuntes cambiaron.
   * `full` (toda la asignatura, todos los chunks analizados con éxito) sustituye el índice; en cualquier otro caso
   * (un documento, fallos o presupuesto agotado) se MEZCLA: solo se reemplaza lo analizado con éxito en esta ejecución.
   */
  const persist = (subjectId: number, full: boolean, fresh: Concept[], replaced: Set<number>): Concept[] => {
    try {
      if (full) {
        store.saveConcepts(subjectId, fresh)
        return fresh
      }
      const order = new Map(store.listChunks(subjectId).map((c, i) => [c.id, i]))
      const merged = mergeConcepts(store.listConcepts(subjectId), fresh, replaced, order)
      store.saveConcepts(subjectId, merged)
      return merged
    } catch (e) {
      if (e instanceof StaleConceptsError) throw new IpcError(STALE, 'STALE')
      throw e
    }
  }

  handle(r, channels.conceptsList, (_e, args): Concept[] => {
    arity(args, 1)
    return store.listConcepts(id(args[0], 'subjectId'))
  })

  handle(r, channels.conceptsBuild, async (event, args): Promise<ConceptsOutcome> => {
    arity(args, 1)
    const p = record(args[0], BUILD_KEYS, 'La solicitud')
    const reqId = requestId(p.requestId)
    const subjectId = id(p.subjectId, 'subjectId')
    const documentId = optId(p.documentId, 'documentId')
    requireSubject(ctx, subjectId)
    if (documentId !== undefined && store.getDocument(documentId)?.subjectId !== subjectId)
      throw notFound('El documento no existe en esta asignatura.')
    if (running.has(reqId)) throw invalid('Ya hay una extracción en curso con ese requestId.')
    if (busy.has(subjectId)) throw invalid('Ya hay una extracción de conceptos en curso en esta asignatura.')

    const controller = new AbortController()
    running.set(reqId, controller)
    busy.add(subjectId)
    try {
      const total = store.listChunks(subjectId, documentId).length
      let analyzed = 0
      const processed: number[] = []
      const failedIds = new Set<number>()
      const onProgress = (done: number, of: number, chunkId?: number): void => {
        analyzed = done
        if (chunkId !== undefined) processed.push(chunkId)
        trySend(event, events.conceptsProgress, { requestId: reqId, done, total: of } satisfies ProgressEvent)
      }
      const concepts = await ctx.core.extractConcepts({ llm: ctx.llm, store }, subjectId, {
        signal: controller.signal,
        onProgress,
        onChunkError: (chunkId) => void failedIds.add(chunkId),
        ...(documentId !== undefined ? { documentId } : {})
      })
      const failed = failedIds.size
      const outcome = (list: Concept[], cancelled: boolean): ConceptsOutcome => ({ concepts: list, cancelled, analyzed: Math.min(analyzed, MAX_CONCEPT_CHUNKS), total, failed })

      // Un resultado parcial (cancelado) nunca sustituye al índice guardado.
      if (controller.signal.aborted) return outcome(concepts, true)
      // Si el modelo no respondió en ningún fragmento, "0 conceptos" sería mentira: se conserva el índice y se avisa.
      if (analyzed > 0 && failed === analyzed) throw new IpcError(MODEL_DOWN, 'MODEL_UNAVAILABLE')
      // Con fallos, un resultado vacío tampoco borra un índice que ya tenía contenido.
      const existing = store.listConcepts(subjectId)
      if (failed > 0 && concepts.length === 0 && existing.length > 0) return outcome(existing, false)
      const replaced = new Set(processed.filter((c) => !failedIds.has(c)))
      const full = documentId === undefined && analyzed === total && failed === 0
      return outcome(persist(subjectId, full, concepts, replaced), false)
    } finally {
      running.delete(reqId)
      busy.delete(subjectId)
    }
  })

  handle(r, channels.conceptsCancel, (_e, args) => {
    arity(args, 1)
    const controller = running.get(requestId(args[0]))
    controller?.abort()
    return { cancelled: controller !== undefined }
  })
}
