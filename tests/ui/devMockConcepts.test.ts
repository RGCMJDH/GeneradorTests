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
})
