import { describe, expect, it } from 'vitest'
import { createDevMockApi } from '../../src/renderer/src/devMock'

async function withNotes() {
  const api = createDevMockApi()
  const res = await api.notes.import(1, 'text')
  if (!res.ok || res.data.canceled) throw new Error('import')
  return api
}

describe('devMock: ejercicios prácticos', () => {
  it('genera un ejercicio con datos y método cuya cita es literal del fragmento', async () => {
    const api = await withNotes()
    const gen = await api.quiz.generate({ requestId: 'r1', subjectId: 1, type: 'practico', count: 1, topic: 'ohm' })
    expect(gen.ok).toBe(true)
    if (!gen.ok) return
    expect(gen.data.insufficient).toBe(false)
    const [q] = gen.data.questions
    expect(q?.type).toBe('practico')
    const chunk = await api.notes.chunk(1, q!.chunkId)
    expect(chunk.ok && chunk.data.text.includes(q!.quote)).toBe(true)
    expect(q!.quote).toMatch(/V = I · R = 2 · 10 = 20 voltios/)
  }, 10_000)

  it('el tema «poesía» no tiene ejercicios: insufficient con el motivo específico', async () => {
    const api = await withNotes()
    const gen = await api.quiz.generate({ requestId: 'r2', subjectId: 1, type: 'practico', count: 2, topic: 'poesía' })
    expect(gen).toEqual({ ok: true, data: { questions: [], discarded: 0, reasons: ['sin material suficiente para ejercicios prácticos'], insufficient: true } })
  })

  it('sin apuntes tampoco hay ejercicios', async () => {
    const gen = await createDevMockApi().quiz.generate({ requestId: 'r3', subjectId: 1, type: 'practico', count: 1 })
    expect(gen.ok && gen.data.insufficient).toBe(true)
  })
})
