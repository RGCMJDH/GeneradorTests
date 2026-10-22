import { describe, it, expect, vi } from 'vitest'
import { openStore, type Store } from '@core/store'
import type { Concept } from '@core/types'
import { channels, events, type Failure, type Result, type ConceptsOutcome } from '../../src/shared/api'
import { registerIpc } from '../../src/main/ipc'
import { realCore, type CoreFns, type IpcContext, type Registrar } from '../../src/main/ipc/context'

type Handler = (event: unknown, ...args: unknown[]) => unknown

async function setup(extract?: CoreFns['extractConcepts'], store?: Store) {
  const st = store ?? (await openStore())
  const handlers = new Map<string, Handler>()
  const registrar: Registrar = { handle: (c, l) => void handlers.set(c, l as Handler) }
  const ctx: IpcContext = {
    store: st,
    llm: { generateJson: async () => ({}), health: async () => ({ ok: true, message: 'ok' }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    userDataDir: 'x',
    model: 'm',
    core: { ...realCore, ...(extract ? { extractConcepts: extract } : {}) }
  }
  registerIpc(ctx, registrar)
  const sent: Array<{ channel: string; payload: unknown }> = []
  const event = { sender: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }), isDestroyed: () => false } }
  const call = async <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => (await handlers.get(channel)!(event, ...args)) as Result<T>
  return { st, call, sent }
}

const fail = (r: Result<unknown>): Failure => {
  expect(r.ok).toBe(false)
  return r as Failure
}

async function withNotes(st: Store) {
  const s = st.createSubject('Bio')
  const o = st.createSubject('Otra')
  const d = st.addDocument({ subjectId: s.id, title: 'd', sourceType: 'text' })
  const d2 = st.addDocument({ subjectId: s.id, title: 'd2', sourceType: 'text' })
  const [c1] = st.addChunks(d.id, s.id, ['El ADN es largo.'])
  const [c2] = st.addChunks(d2.id, s.id, ['Los ribosomas.'])
  const od = st.addDocument({ subjectId: o.id, title: 'od', sourceType: 'text' })
  const [co] = st.addChunks(od.id, o.id, ['El ADN ajeno.'])
  return { s, o, d, d2, c1, c2, co }
}

const fakeExtract = (concepts: (chunkId: number) => Concept[], chunkId = 0): CoreFns['extractConcepts'] =>
  (async (_deps, _sid, opts) => {
    opts?.onProgress?.(1, 2)
    opts?.onProgress?.(2, 2)
    return concepts(chunkId)
  }) as CoreFns['extractConcepts']

describe('canales de conceptos', () => {
  it('los nombres están declarados', () => {
    expect(channels.conceptsList).toBe('concepts:list')
    expect(channels.conceptsBuild).toBe('concepts:build')
    expect(channels.conceptsCancel).toBe('concepts:cancel')
    expect(events.conceptsProgress).toBe('concepts:progress')
  })
})

describe('concepts:list', () => {
  it('devuelve lo guardado de esa asignatura, sin mezclar otra', async () => {
    const { st, call } = await setup()
    const { s, o, c1, co } = await withNotes(st)
    st.saveConcepts(s.id, [{ term: 'ADN', chunkIds: [c1.id], related: [] }])
    st.saveConcepts(o.id, [{ term: 'ADN', chunkIds: [co.id], related: [] }])
    expect(await call('concepts:list', s.id)).toEqual({ ok: true, data: [{ term: 'ADN', chunkIds: [c1.id], related: [] }] })
    expect(await call('concepts:list', 9999)).toEqual({ ok: true, data: [] })
  })
})

describe('concepts:build', () => {
  it('ejecuta el core con el store, emite progreso con el requestId, guarda y devuelve el resultado', async () => {
    const st = await openStore()
    const { s, c1 } = await withNotes(st)
    const extract = vi.fn(fakeExtract(() => [{ term: 'ADN', chunkIds: [c1.id], related: [] }]))
    const t = await setup(extract as unknown as CoreFns['extractConcepts'], st)
    const r = await t.call<ConceptsOutcome>('concepts:build', { requestId: 'c1', subjectId: s.id })
    expect(r).toEqual({ ok: true, data: { concepts: [{ term: 'ADN', chunkIds: [c1.id], related: [] }], cancelled: false, analyzed: 2, total: 2 } })
    expect(t.sent).toEqual([
      { channel: events.conceptsProgress, payload: { requestId: 'c1', done: 1, total: 2 } },
      { channel: events.conceptsProgress, payload: { requestId: 'c1', done: 2, total: 2 } }
    ])
    expect(st.listConcepts(s.id)).toEqual([{ term: 'ADN', chunkIds: [c1.id], related: [] }])
    expect((extract.mock.calls[0] as unknown[])[1]).toBe(s.id)
    expect(((extract.mock.calls[0] as unknown[])[2] as { documentId?: number }).documentId).toBeUndefined()
  })

  it('asignatura inexistente: NOT_FOUND sin tocar el core', async () => {
    const extract = vi.fn()
    const { call } = await setup(extract as unknown as CoreFns['extractConcepts'])
    const r = fail(await call('concepts:build', { requestId: 'x', subjectId: 77 }))
    expect(r.code).toBe('NOT_FOUND')
    expect(extract).not.toHaveBeenCalled()
  })

  it('con documentId de otra asignatura: NOT_FOUND', async () => {
    const st = await openStore()
    const { s, o } = await withNotes(st)
    const od = st.listDocuments(o.id)[0]
    const extract = vi.fn()
    const { call } = await setup(extract as unknown as CoreFns['extractConcepts'], st)
    expect(fail(await call('concepts:build', { requestId: 'x', subjectId: s.id, documentId: od.id })).code).toBe('NOT_FOUND')
    expect(extract).not.toHaveBeenCalled()
  })

  it('con documentId analiza solo ese documento y NO sustituye el índice guardado', async () => {
    const st = await openStore()
    const { s, d, c1, c2 } = await withNotes(st)
    st.saveConcepts(s.id, [{ term: 'ribosomas', chunkIds: [c2.id], related: [] }])
    const extract = vi.fn(fakeExtract(() => [{ term: 'ADN', chunkIds: [c1.id], related: [] }]))
    const { call } = await setup(extract as unknown as CoreFns['extractConcepts'], st)
    const r = await call<ConceptsOutcome>('concepts:build', { requestId: 'd', subjectId: s.id, documentId: d.id })
    expect(r.ok && r.data.concepts.map((c) => c.term)).toEqual(['ADN'])
    expect(((extract.mock.calls[0] as unknown[])[2] as { documentId?: number }).documentId).toBe(d.id)
    expect(st.listConcepts(s.id).map((c) => c.term)).toEqual(['ribosomas'])
  })

  it('cancelar aborta la señal, devuelve cancelled:true y NO guarda lo parcial (se conserva el índice anterior)', async () => {
    const st = await openStore()
    const { s, c1, c2 } = await withNotes(st)
    st.saveConcepts(s.id, [{ term: 'ribosomas', chunkIds: [c2.id], related: [] }])
    let started!: () => void
    const running = new Promise<void>((res) => (started = res))
    let runs = 0
    const extract: CoreFns['extractConcepts'] = async (_d, _s, opts) => {
      if (++runs > 1) return []
      started()
      await new Promise<void>((res) => opts!.signal!.addEventListener('abort', () => res()))
      return [{ term: 'ADN', chunkIds: [c1.id], related: [] }]
    }
    const { call } = await setup(extract, st)
    const pending = call<ConceptsOutcome>('concepts:build', { requestId: 'a', subjectId: s.id })
    await running
    expect(fail(await call('concepts:build', { requestId: 'a', subjectId: s.id })).code).toBe('INVALID') // mismo requestId
    expect(fail(await call('concepts:build', { requestId: 'b', subjectId: s.id })).code).toBe('INVALID') // misma asignatura ya en curso
    expect(await call('concepts:cancel', 'otro')).toEqual({ ok: true, data: { cancelled: false } })
    expect(await call('concepts:cancel', 'a')).toEqual({ ok: true, data: { cancelled: true } })
    const r = await pending
    expect(r).toMatchObject({ ok: true, data: { cancelled: true, concepts: [{ term: 'ADN' }] } })
    expect(st.listConcepts(s.id).map((c) => c.term)).toEqual(['ribosomas'])
    expect(await call('concepts:cancel', 'a')).toEqual({ ok: true, data: { cancelled: false } })
    // tras terminar, el requestId y la asignatura quedan libres
    expect((await call('concepts:build', { requestId: 'a', subjectId: s.id })).ok).toBe(true)
  })

  it('libera el requestId y la asignatura aunque el core lance', async () => {
    const { st, call } = await setup((async () => { throw new Error('fallo') }) as unknown as CoreFns['extractConcepts'])
    const { s } = await withNotes(st)
    expect(fail(await call('concepts:build', { requestId: 'z', subjectId: s.id })).error).toBe('fallo')
    expect(fail(await call('concepts:build', { requestId: 'z', subjectId: s.id })).error).toBe('fallo')
  })

  it('un envío de progreso que lanza no rompe la extracción', async () => {
    const st = await openStore()
    const { s, c1 } = await withNotes(st)
    const handlers = new Map<string, Handler>()
    const ctx: IpcContext = {
      store: st,
      llm: { generateJson: async () => ({}), health: async () => ({ ok: true, message: 'ok' }) },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      userDataDir: 'x',
      model: 'm',
      core: { ...realCore, extractConcepts: fakeExtract(() => [{ term: 'ADN', chunkIds: [c1.id], related: [] }]) }
    }
    registerIpc(ctx, { handle: (c, l) => void handlers.set(c, l as Handler) })
    const dead = { sender: { send: () => { throw new Error('destroyed') }, isDestroyed: () => false } }
    const r = (await handlers.get(channels.conceptsBuild)!(dead, { requestId: 'q', subjectId: s.id })) as Result<unknown>
    expect(r.ok).toBe(true)
  })

  it('si el modelo devolviera un chunk ajeno, guardar falla y se informa (no se guarda nada)', async () => {
    const st = await openStore()
    const { s, co } = await withNotes(st)
    const { call } = await setup(fakeExtract(() => [{ term: 'ADN', chunkIds: [co.id], related: [] }]), st)
    expect(fail(await call('concepts:build', { requestId: 'x', subjectId: s.id })).code).toBe('INTERNAL')
    expect(st.listConcepts(s.id)).toEqual([])
  })
})
