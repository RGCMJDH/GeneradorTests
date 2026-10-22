import { describe, it, expect } from 'vitest'
import { openStore, type Store } from '@core/store'
import type { Concept } from '@core/types'
import type { ConceptsOutcome, Failure, Result } from '../../src/shared/api'
import { registerIpc } from '../../src/main/ipc'
import { realCore, type CoreFns, type IpcContext, type Registrar } from '../../src/main/ipc/context'

type Handler = (event: unknown, ...args: unknown[]) => unknown

async function setup(extract: CoreFns['extractConcepts'], store: Store) {
  const handlers = new Map<string, Handler>()
  const registrar: Registrar = { handle: (c, l) => void handlers.set(c, l as Handler) }
  const ctx: IpcContext = {
    store,
    llm: { generateJson: async () => ({}), health: async () => ({ ok: true, message: 'ok' }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    userDataDir: 'x',
    model: 'm',
    core: { ...realCore, extractConcepts: extract }
  }
  registerIpc(ctx, registrar)
  const event = { sender: { send: () => {}, isDestroyed: () => false } }
  return async <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => (await handlers.get(channel)!(event, ...args)) as Result<T>
}

async function notes() {
  const st = await openStore()
  const s = st.createSubject('Bio')
  const d1 = st.addDocument({ subjectId: s.id, title: 'd1', sourceType: 'text' })
  const d2 = st.addDocument({ subjectId: s.id, title: 'd2', sourceType: 'text' })
  const [a1, a2] = st.addChunks(d1.id, s.id, ['El ADN y el ATP.', 'El ADN otra vez, el ATP y el ARN.'])
  const [b1, b2] = st.addChunks(d2.id, s.id, ['Los ribosomas y el ARN.', 'El ARN de nuevo.'])
  return { st, s, d1, d2, a1, a2, b1, b2 }
}

/** Core falso: procesa `processed` (con progreso por chunk), marca `failed` como fallidos y devuelve `result`. */
const fake = (opts: { processed: number[]; failed?: number[]; result: Concept[] }): CoreFns['extractConcepts'] =>
  (async (_d, _s, o) => {
    opts.processed.forEach((id, i) => {
      if (opts.failed?.includes(id)) o?.onChunkError?.(id, 'error del modelo: x')
      o?.onProgress?.(i + 1, opts.processed.length, id)
    })
    return opts.result
  }) as CoreFns['extractConcepts']

const fail = (r: Result<unknown>): Failure => {
  expect(r.ok).toBe(false)
  return r as Failure
}
const terms = (st: Store, sid: number) => st.listConcepts(sid).map((c) => c.term)

describe('concepts:build: fallos del modelo', () => {
  it('si fallan todos los chunks: error MODEL_UNAVAILABLE y el índice anterior queda intacto', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ADN', chunkIds: [a1.id], related: [] }])
    const call = await setup(fake({ processed: [a1.id, a2.id, b1.id, b2.id], failed: [a1.id, a2.id, b1.id, b2.id], result: [] }), st)
    const r = fail(await call('concepts:build', { requestId: 'r', subjectId: s.id }))
    expect(r.code).toBe('MODEL_UNAVAILABLE')
    expect(r.error).toBe('No se pudieron extraer conceptos: el modelo no respondió. Comprueba que Ollama está en marcha.')
    expect(terms(st, s.id)).toEqual(['ADN'])
  })

  it('fallo parcial: guarda lo extraído y devuelve el nº de fragmentos fallidos', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    const call = await setup(
      fake({ processed: [a1.id, a2.id, b1.id, b2.id], failed: [b2.id], result: [{ term: 'ADN', chunkIds: [a1.id, a2.id], related: [] }] }),
      st
    )
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { cancelled: false, analyzed: 4, total: 4, failed: 1 } })
    expect(terms(st, s.id)).toEqual(['ADN'])
  })

  it('con fallos y resultado VACÍO no sobrescribe un índice existente no vacío', async () => {
    const { st, s, a1, a2, b1 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ADN', chunkIds: [a1.id], related: [] }])
    const call = await setup(fake({ processed: [a1.id, a2.id, b1.id], failed: [a2.id], result: [] }), st)
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { failed: 1, cancelled: false, concepts: [{ term: 'ADN' }] } })
    expect(terms(st, s.id)).toEqual(['ADN'])
  })

  it('sin fallos, un resultado vacío sí sustituye el índice (los apuntes ya no tienen conceptos)', async () => {
    const { st, s, a1, a2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ADN', chunkIds: [a1.id], related: [] }])
    const call = await setup(fake({ processed: [a1.id, a2.id], result: [] }), st)
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { failed: 0, concepts: [] } })
    expect(terms(st, s.id)).toEqual([])
  })

  it('si el modelo falla en un build de un documento concreto, tampoco se guarda nada', async () => {
    const { st, s, d1, a1, a2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ADN', chunkIds: [a1.id], related: [] }])
    const call = await setup(fake({ processed: [a1.id, a2.id], failed: [a1.id, a2.id], result: [] }), st)
    expect(fail(await call('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id })).code).toBe('MODEL_UNAVAILABLE')
    expect(terms(st, s.id)).toEqual(['ADN'])
  })
})

describe('concepts:build con documentId: mezcla con el índice', () => {
  it('conserva los conceptos de los otros documentos y reemplaza los de ese documento', async () => {
    const { st, s, d1, a1, a2, b1, b2 } = await notes()
    st.saveConcepts(s.id, [
      { term: 'ADN', chunkIds: [a1.id, a2.id], related: ['ATP'] },
      { term: 'ATP', chunkIds: [a1.id], related: ['ADN'] },
      { term: 'ARN', chunkIds: [b1.id, b2.id], related: ['ribosomas'] },
      { term: 'ribosomas', chunkIds: [b1.id], related: ['ARN'] }
    ])
    // Se reextrae el documento 1: ahora solo sale «ADN» (en un chunk) y «ARN» (que también sale en el doc 2).
    const call = await setup(
      fake({
        processed: [a1.id, a2.id],
        result: [
          { term: 'ADN', chunkIds: [a2.id], related: ['ARN'] },
          { term: 'ARN', chunkIds: [a2.id], related: ['ADN'] }
        ]
      }),
      st
    )
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id })
    expect(r.ok).toBe(true)
    const idx = st.listConcepts(s.id)
    const by = (t: string) => idx.find((c) => c.term === t)
    expect(by('ATP')).toBeUndefined() // solo estaba en el doc 1 y ya no sale
    expect(by('ADN')?.chunkIds).toEqual([a2.id])
    expect(by('ARN')?.chunkIds).toEqual([a2.id, b1.id, b2.id]) // unido: un único «ARN»
    expect(idx.filter((c) => c.term === 'ARN')).toHaveLength(1)
    expect(by('ribosomas')?.chunkIds).toEqual([b1.id]) // otro documento: intacto
    expect(r.ok && r.data.concepts).toEqual(idx) // el DTO es el índice resultante, no solo lo nuevo
  })

  it('un chunk fallido conserva sus conceptos anteriores (solo se reemplazan los chunks analizados con éxito)', async () => {
    const { st, s, d1, a1, a2 } = await notes()
    st.saveConcepts(s.id, [
      { term: 'ADN', chunkIds: [a1.id], related: [] },
      { term: 'ATP', chunkIds: [a2.id], related: [] }
    ])
    const call = await setup(fake({ processed: [a1.id, a2.id], failed: [a2.id], result: [{ term: 'ADN', chunkIds: [a1.id], related: [] }] }), st)
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id })
    expect(r).toMatchObject({ ok: true, data: { failed: 1 } })
    expect(terms(st, s.id)).toEqual(['ADN', 'ATP'])
  })

  it('un chunk no analizado (fuera del presupuesto) conserva sus conceptos', async () => {
    const { st, s, d1, a1, a2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ATP', chunkIds: [a2.id], related: [] }])
    const call = await setup(fake({ processed: [a1.id], result: [{ term: 'ADN', chunkIds: [a1.id], related: [] }] }), st)
    await call('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id })
    expect(terms(st, s.id)).toEqual(['ADN', 'ATP'])
  })

  it('cancelado: no se guarda nada', async () => {
    const { st, s, d1, a1, a2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ATP', chunkIds: [a2.id], related: [] }])
    let started!: () => void
    const running = new Promise<void>((res) => (started = res))
    const extract: CoreFns['extractConcepts'] = async (_d, _s, o) => {
      started()
      await new Promise<void>((res) => o!.signal!.addEventListener('abort', () => res()))
      return [{ term: 'ADN', chunkIds: [a1.id], related: [] }]
    }
    const call = await setup(extract, st)
    const pending = call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id })
    await running
    await call('concepts:cancel', 'r')
    expect(await pending).toMatchObject({ ok: true, data: { cancelled: true } })
    expect(terms(st, s.id)).toEqual(['ATP'])
  })

  it('si los apuntes cambiaron durante la extracción: STALE y no se guarda nada', async () => {
    const { st, s, d1, a1, a2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ATP', chunkIds: [a2.id], related: [] }])
    const extract: CoreFns['extractConcepts'] = async () => {
      st.deleteDocument(d1.id) // el usuario borra el documento mientras se extraía
      return [{ term: 'ADN', chunkIds: [a1.id], related: [] }]
    }
    const call = await setup(extract, st)
    const r = fail(await call('concepts:build', { requestId: 'r', subjectId: s.id, documentId: d1.id }))
    expect(r.code).toBe('STALE')
  })
})
