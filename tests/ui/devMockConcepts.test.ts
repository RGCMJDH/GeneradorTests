import { describe, expect, it } from 'vitest'
import { createDevMockApi } from '../../src/renderer/src/devMock'

describe('devMock: conceptos', () => {
  it('extrae solo términos que aparecen literalmente en sus fragmentos y los guarda', async () => {
    const api = createDevMockApi()
    await api.notes.import(1, 'text')
    expect(await api.concepts.list(1)).toEqual({ ok: true, data: [] })
    const built = await api.concepts.build({ requestId: 'c1', subjectId: 1 })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.data.cancelled).toBe(false)
    expect(built.data.concepts.length).toBeGreaterThan(0)
    for (const c of built.data.concepts) {
      for (const id of c.chunkIds) {
        const chunk = await api.notes.chunk(1, id)
        expect(chunk.ok && chunk.data.text.toLowerCase()).toContain(c.term.toLowerCase())
      }
      expect(c.related).not.toContain(c.term)
    }
    expect(await api.concepts.list(1)).toEqual({ ok: true, data: built.data.concepts })
    expect(await api.concepts.list(2)).toEqual({ ok: true, data: [] })
  }, 15_000)

  it('cancelar devuelve lo parcial sin guardarlo', async () => {
    const api = createDevMockApi()
    await api.notes.import(1, 'text')
    const pending = api.concepts.build({ requestId: 'c2', subjectId: 1 })
    await api.concepts.cancel('c2')
    const r = await pending
    expect(r.ok && r.data.cancelled).toBe(true)
    expect(await api.concepts.list(1)).toEqual({ ok: true, data: [] })
  }, 15_000)

  it('con documentId solo analiza ese documento y el índice se mezcla con lo anterior', async () => {
    const api = createDevMockApi()
    const first = await api.notes.import(1, 'text')
    const second = await api.notes.import(1, 'text')
    if (!first.ok || first.data.canceled || first.data.kind === 'image' || !second.ok || second.data.canceled || second.data.kind === 'image') throw new Error('import')
    const a = await api.concepts.build({ requestId: 'c3', subjectId: 1, documentId: first.data.document.id })
    expect(a.ok && a.data.total).toBe(first.data.document.chunkCount)
    const afterFirst = await api.concepts.list(1)
    const b = await api.concepts.build({ requestId: 'c4', subjectId: 1, documentId: second.data.document.id })
    expect(b.ok && b.data.analyzed).toBe(second.data.document.chunkCount)
    const merged = b.ok ? b.data.concepts : []
    const before = afterFirst.ok ? afterFirst.data : []
    expect(merged.length).toBe(before.length) // mismos términos
    for (const c of merged) expect(c.chunkIds.length).toBe((before.find((x) => x.term === c.term)?.chunkIds.length ?? 0) * 2) // ahora de los dos documentos
  }, 20_000)
})
