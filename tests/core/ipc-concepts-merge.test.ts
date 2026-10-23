import { describe, it, expect } from 'vitest'
import { openStore, type Store } from '@core/store'
import type { Concept } from '@core/types'
import type { LlmProvider } from '@core/llm'
import type { ConceptsOutcome, Result } from '../../src/shared/api'
import { registerIpc } from '../../src/main/ipc'
import { realCore, type CoreFns, type IpcContext, type Registrar } from '../../src/main/ipc/context'

type Handler = (event: unknown, ...args: unknown[]) => unknown

async function setup(store: Store, over: { extract?: CoreFns['extractConcepts']; llm?: LlmProvider } = {}) {
  const handlers = new Map<string, Handler>()
  const registrar: Registrar = { handle: (c, l) => void handlers.set(c, l as Handler) }
  const ctx: IpcContext = {
    store,
    llm: over.llm ?? { generateJson: async () => ({}), health: async () => ({ ok: true, message: 'ok' }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    userDataDir: 'x',
    model: 'm',
    core: { ...realCore, ...(over.extract ? { extractConcepts: over.extract } : {}) }
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

/** Core falso con progreso por chunk (como el real): procesa `processed`, marca `failed` y devuelve `result`. */
const fake = (o: { processed: number[]; failed?: number[]; result: Concept[] }): CoreFns['extractConcepts'] =>
  (async (_d, _s, opts) => {
    o.processed.forEach((id, i) => {
      if (o.failed?.includes(id)) opts?.onChunkError?.(id, 'error del modelo: x')
      opts?.onProgress?.(i + 1, o.processed.length, id)
    })
    return o.result
  }) as CoreFns['extractConcepts']

const byTerm = (st: Store, sid: number, t: string) => st.listConcepts(sid).find((c) => c.term === t)

describe('concepts:build de toda la asignatura: sustituir solo si se analizó todo con éxito', () => {
  it('con un chunk fallido conserva los conceptos anteriores de ese chunk', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    st.saveConcepts(s.id, [
      { term: 'ARN', chunkIds: [b1.id, b2.id], related: [] },
      { term: 'ribosomas', chunkIds: [b1.id], related: [] }
    ])
    // b2 falla; b1 se reextrae con éxito y «ribosomas» ya no sale; sale «ADN».
    const call = await setup(st, {
      extract: fake({ processed: [a1.id, a2.id, b1.id, b2.id], failed: [b2.id], result: [{ term: 'ADN', chunkIds: [a1.id], related: [] }] })
    })
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { failed: 1, analyzed: 4, total: 4 } })
    expect(byTerm(st, s.id, 'ARN')?.chunkIds).toEqual([b2.id]) // b2 no se tocó
    expect(byTerm(st, s.id, 'ribosomas')).toBeUndefined() // b1 sí se reextrajo
    expect(byTerm(st, s.id, 'ADN')?.chunkIds).toEqual([a1.id])
    expect(r.ok && r.data.concepts).toEqual(st.listConcepts(s.id))
  })

  it('si el presupuesto no cubre todos los chunks conserva los conceptos de los no analizados', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    st.saveConcepts(s.id, [{ term: 'ARN', chunkIds: [b1.id, b2.id], related: [] }])
    const call = await setup(st, { extract: fake({ processed: [a1.id, a2.id], result: [{ term: 'ADN', chunkIds: [a1.id, a2.id], related: [] }] }) })
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { analyzed: 2, total: 4, failed: 0 } })
    expect(st.listConcepts(s.id).map((c) => c.term)).toEqual(['ADN', 'ARN'])
  })

  it('integración real con >60 chunks: lo construido antes para un documento fuera del presupuesto sobrevive', async () => {
    const st = await openStore()
    const s = st.createSubject('Grande')
    const d1 = st.addDocument({ subjectId: s.id, title: 'uno', sourceType: 'text' })
    const d2 = st.addDocument({ subjectId: s.id, title: 'dos', sourceType: 'text' })
    st.addChunks(d1.id, s.id, Array.from({ length: 50 }, (_, i) => `uno pieza ${i}`))
    const c2 = st.addChunks(d2.id, s.id, Array.from({ length: 50 }, (_, i) => (i === 45 ? 'dos pieza 45 gamma' : `dos pieza ${i}`)))
    const gamma = c2[45]
    st.saveConcepts(s.id, [{ term: 'gamma', chunkIds: [gamma.id], related: [] }]) // construido antes; el chunk 45 queda fuera de los 60
    const llm: LlmProvider = { generateJson: async () => ({ conceptos: ['pieza'] }), health: async () => ({ ok: true, message: 'ok' }) }
    const call = await setup(st, { llm })
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { analyzed: 60, total: 100, failed: 0 } })
    const idx = st.listConcepts(s.id)
    expect(idx.find((c) => c.term === 'gamma')?.chunkIds).toEqual([gamma.id])
    expect(idx.find((c) => c.term === 'pieza')?.chunkIds).toHaveLength(60)
  })

  it('un build completo y sin fallos sigue sustituyendo: desaparecen los conceptos obsoletos de lo reextraído', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    st.saveConcepts(s.id, [
      { term: 'ATP', chunkIds: [a1.id, a2.id], related: [] },
      { term: 'ribosomas', chunkIds: [b1.id], related: [] }
    ])
    const call = await setup(st, { extract: fake({ processed: [a1.id, a2.id, b1.id, b2.id], result: [{ term: 'ADN', chunkIds: [a1.id], related: [] }] }) })
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(r).toMatchObject({ ok: true, data: { analyzed: 4, total: 4, failed: 0 } })
    expect(st.listConcepts(s.id).map((c) => c.term)).toEqual(['ADN'])
  })

  it('la mezcla recalcula related con los chunks resultantes (no arrastra relaciones antiguas)', async () => {
    const { st, s, a1, a2, b1, b2 } = await notes()
    // ATP y ARN compartían a2; al reextraer a2 solo queda ATP ahí. ARN sigue por b1/b2.
    st.saveConcepts(s.id, [
      { term: 'ATP', chunkIds: [a2.id], related: ['ARN'] },
      { term: 'ARN', chunkIds: [a2.id, b1.id, b2.id], related: ['ATP', 'ribosomas'] },
      { term: 'ribosomas', chunkIds: [b1.id], related: ['ARN'] }
    ])
    const call = await setup(st, { extract: fake({ processed: [a1.id, a2.id], result: [{ term: 'ATP', chunkIds: [a2.id], related: [] }] }) })
    await call('concepts:build', { requestId: 'r', subjectId: s.id })
    expect(byTerm(st, s.id, 'ATP')?.related).toEqual([])
    expect(byTerm(st, s.id, 'ARN')?.related).toEqual(['ribosomas'])
  })
})
