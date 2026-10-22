import { MAX_CONCEPT_CHUNKS } from '@core/graph'
import { channels, events, type Concept, type ConceptsOutcome, type ProgressEvent } from '../../shared/api'
import { handle, invalid, notFound, trySend } from './common'
import type { IpcContext, Registrar } from './context'
import { requireSubject } from './subjects'
import { arity, id, optId, record, requestId } from './validate'

const BUILD_KEYS = ['requestId', 'subjectId', 'documentId'] as const

export function registerConcepts(ctx: IpcContext, r: Registrar): void {
  const { store } = ctx
  /** Extracciones en curso, por requestId del renderer. */
  const running = new Map<string, AbortController>()
  /** Asignaturas con una extracción en curso: dos a la vez solo gastarían CPU y se pisarían al guardar. */
  const busy = new Set<number>()

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
      const onProgress = (done: number, of: number): void => {
        analyzed = done
        trySend(event, events.conceptsProgress, { requestId: reqId, done, total: of } satisfies ProgressEvent)
      }
      const concepts = await ctx.core.extractConcepts({ llm: ctx.llm, store }, subjectId, {
        signal: controller.signal,
        onProgress,
        ...(documentId !== undefined ? { documentId } : {})
      })
      const cancelled = controller.signal.aborted
      // Un resultado parcial (cancelado) o de un solo documento nunca sustituye al índice guardado de la asignatura.
      if (!cancelled && documentId === undefined) store.saveConcepts(subjectId, concepts)
      return { concepts, cancelled, analyzed: Math.min(analyzed, MAX_CONCEPT_CHUNKS), total }
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
