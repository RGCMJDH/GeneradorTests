import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '@core/store'

async function setup() {
  const store = await openStore()
  const a = store.createSubject('A')
  const b = store.createSubject('B')
  const d1 = store.addDocument({ subjectId: a.id, title: 'd1', sourceType: 'text' })
  const d2 = store.addDocument({ subjectId: a.id, title: 'd2', sourceType: 'text' })
  const db = store.addDocument({ subjectId: b.id, title: 'db', sourceType: 'text' })
  const [c1, c2] = store.addChunks(d1.id, a.id, ['La mitocondria produce ATP.', 'El ATP es energía.'])
  const [c3] = store.addChunks(d2.id, a.id, ['Los ribosomas sintetizan proteínas.'])
  const [cb] = store.addChunks(db.id, b.id, ['La mitocondria de otra asignatura.'])
  return { store, a, b, d1, d2, c1, c2, c3, cb }
}

describe('store: conceptos', () => {
  it('guarda y lista conceptos con sus fragmentos y relacionados', async () => {
    const { store, a, c1, c2 } = await setup()
    store.saveConcepts(a.id, [
      { term: 'ATP', chunkIds: [c1.id, c2.id], related: ['mitocondria'] },
      { term: 'mitocondria', chunkIds: [c1.id], related: ['ATP'] }
    ])
    expect(store.listConcepts(a.id)).toEqual([
      { term: 'ATP', chunkIds: [c1.id, c2.id], related: ['mitocondria'] },
      { term: 'mitocondria', chunkIds: [c1.id], related: ['ATP'] }
    ])
  })

  it('sin conceptos guardados devuelve []', async () => {
    const { store, a } = await setup()
    expect(store.listConcepts(a.id)).toEqual([])
  })

  it('aísla por asignatura', async () => {
    const { store, a, b, c1, cb } = await setup()
    store.saveConcepts(a.id, [{ term: 'ATP', chunkIds: [c1.id], related: [] }])
    store.saveConcepts(b.id, [{ term: 'mitocondria', chunkIds: [cb.id], related: [] }])
    expect(store.listConcepts(a.id).map((c) => c.term)).toEqual(['ATP'])
    expect(store.listConcepts(b.id).map((c) => c.term)).toEqual(['mitocondria'])
  })

  it('guardar reemplaza el conjunto de esa asignatura y no toca el de otra', async () => {
    const { store, a, b, c1, c3, cb } = await setup()
    store.saveConcepts(b.id, [{ term: 'otra', chunkIds: [cb.id], related: [] }])
    store.saveConcepts(a.id, [{ term: 'ATP', chunkIds: [c1.id], related: [] }])
    store.saveConcepts(a.id, [{ term: 'ribosomas', chunkIds: [c3.id], related: [] }])
    expect(store.listConcepts(a.id).map((c) => c.term)).toEqual(['ribosomas'])
    expect(store.listConcepts(b.id).map((c) => c.term)).toEqual(['otra'])
    store.saveConcepts(a.id, [])
    expect(store.listConcepts(a.id)).toEqual([])
    expect(store.listConcepts(b.id)).toHaveLength(1)
  })

  it('un concepto que cita un chunk de otra asignatura lanza y no cambia nada (atómico)', async () => {
    const { store, a, c1, cb } = await setup()
    store.saveConcepts(a.id, [{ term: 'ATP', chunkIds: [c1.id], related: [] }])
    expect(() =>
      store.saveConcepts(a.id, [
        { term: 'nuevo', chunkIds: [c1.id], related: [] },
        { term: 'ajeno', chunkIds: [cb.id], related: [] }
      ])
    ).toThrow()
    expect(store.listConcepts(a.id).map((c) => c.term)).toEqual(['ATP'])
    expect(() => store.saveConcepts(a.id, [{ term: 'fantasma', chunkIds: [99999], related: [] }])).toThrow()
    expect(store.listConcepts(a.id).map((c) => c.term)).toEqual(['ATP'])
  })

  it('un concepto sin ningún chunk lanza', async () => {
    const { store, a } = await setup()
    expect(() => store.saveConcepts(a.id, [{ term: 'vacío', chunkIds: [], related: [] }])).toThrow()
  })

  it('deleteDocument invalida: quita los chunks borrados y los conceptos que se quedan sin ninguno', async () => {
    const { store, a, d2, c1, c3 } = await setup()
    store.saveConcepts(a.id, [
      { term: 'ATP', chunkIds: [c1.id, c3.id], related: ['ribosomas'] },
      { term: 'ribosomas', chunkIds: [c3.id], related: ['ATP'] }
    ])
    store.deleteDocument(d2.id)
    expect(store.listConcepts(a.id)).toEqual([{ term: 'ATP', chunkIds: [c1.id], related: [] }]) // sin referencias a conceptos desaparecidos
  })

  it('deleteChunks invalida igual', async () => {
    const { store, a, d1, c1, c2, c3 } = await setup()
    store.saveConcepts(a.id, [
      { term: 'ATP', chunkIds: [c1.id, c2.id], related: [] },
      { term: 'ribosomas', chunkIds: [c3.id], related: [] }
    ])
    store.deleteChunks(d1.id)
    expect(store.listConcepts(a.id).map((c) => c.term)).toEqual(['ribosomas'])
  })

  it('si el texto del chunk cambia y ya no contiene el término, ese chunk deja de contar', async () => {
    const { store, a, c1, c2 } = await setup()
    store.saveConcepts(a.id, [{ term: 'ATP', chunkIds: [c1.id, c2.id], related: [] }])
    store.updateChunkText(c1.id, 'Texto reescrito sin ese término.')
    expect(store.listConcepts(a.id)).toEqual([{ term: 'ATP', chunkIds: [c2.id], related: [] }])
    store.updateChunkText(c2.id, 'Ya tampoco.')
    expect(store.listConcepts(a.id)).toEqual([])
  })

  it('persiste a disco y reabre con los mismos conceptos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-concepts-'))
    const file = join(dir, 'datos.sqlite')
    try {
      const s1 = await openStore(file)
      const sub = s1.createSubject('S')
      const doc = s1.addDocument({ subjectId: sub.id, title: 't', sourceType: 'text' })
      const [c] = s1.addChunks(doc.id, sub.id, ['El ADN es largo.'])
      s1.saveConcepts(sub.id, [{ term: 'ADN', chunkIds: [c.id], related: [] }])
      const s2 = await openStore(file)
      expect(s2.listConcepts(sub.id)).toEqual([{ term: 'ADN', chunkIds: [c.id], related: [] }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
