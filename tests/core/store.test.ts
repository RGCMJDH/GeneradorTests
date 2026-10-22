import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '@core/store'

describe('store', () => {
  it('crea y lista asignaturas', async () => {
    const store = await openStore()
    const a = store.createSubject('Biología')
    const b = store.createSubject('Historia')
    expect(a.id).not.toBe(b.id)
    expect(store.listSubjects().map((s) => s.name)).toEqual(['Biología', 'Historia'])
  })

  it('chunks de una asignatura no aparecen en otra', async () => {
    const store = await openStore()
    const a = store.createSubject('A')
    const b = store.createSubject('B')
    const docA = store.addDocument({ subjectId: a.id, title: 'doc A', sourceType: 'text' })
    const docB = store.addDocument({ subjectId: b.id, title: 'doc B', sourceType: 'pdf', path: 'x.pdf' })
    store.addChunks(docA.id, a.id, ['uno', 'dos'])
    store.addChunks(docB.id, b.id, ['tres'])
    expect(store.listChunks(a.id).map((c) => c.text)).toEqual(['uno', 'dos'])
    expect(store.listChunks(b.id).map((c) => c.text)).toEqual(['tres'])
    // filtrar por documento de otra asignatura no filtra datos ajenos
    expect(store.listChunks(a.id, docB.id)).toEqual([])
    expect(store.listChunks(a.id, docA.id)).toHaveLength(2)
    expect(store.listChunks(a.id).map((c) => c.position)).toEqual([0, 1])
  })

  it('borrar documento borra sus chunks (y las preguntas de esos chunks)', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const d1 = store.addDocument({ subjectId: s.id, title: 'd1', sourceType: 'text' })
    const d2 = store.addDocument({ subjectId: s.id, title: 'd2', sourceType: 'text' })
    const [c1] = store.addChunks(d1.id, s.id, ['a', 'b'])
    store.addChunks(d2.id, s.id, ['c'])
    store.saveQuestion({
      subjectId: s.id, chunkId: c1.id, type: 'vf', prompt: 'p', answer: 'V', explanation: 'e', quote: 'a'
    })
    store.deleteDocument(d1.id)
    expect(store.listChunks(s.id).map((c) => c.text)).toEqual(['c'])
    expect(store.getChunk(c1.id)).toBeUndefined()
    expect(store.listQuestions(s.id)).toEqual([])
  })

  it('actualiza el texto de un chunk', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const d = store.addDocument({ subjectId: s.id, title: 'd', sourceType: 'image' })
    const [c] = store.addChunks(d.id, s.id, ['viejo'])
    store.updateChunkText(c.id, 'nuevo')
    expect(store.getChunk(c.id)?.text).toBe('nuevo')
  })

  it('guarda y lista preguntas con opciones', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const other = store.createSubject('Otra')
    const d = store.addDocument({ subjectId: s.id, title: 'd', sourceType: 'text' })
    const [c] = store.addChunks(d.id, s.id, ['texto'])
    const saved = store.saveQuestion({
      subjectId: s.id, chunkId: c.id, type: 'test', prompt: '¿Cuál?',
      options: ['a', 'b', 'c', "d'; DROP TABLE questions;--"], answer: 'b', explanation: 'porque', quote: 'texto'
    })
    store.saveQuestion({
      subjectId: s.id, chunkId: c.id, type: 'desarrollo', prompt: 'Explica', answer: 'x', explanation: 'y', quote: 'texto'
    })
    expect(saved.id).toBeTypeOf('number')
    const qs = store.listQuestions(s.id)
    expect(qs).toHaveLength(2)
    expect(qs[0]).toEqual(saved)
    expect(qs[0].options).toEqual(['a', 'b', 'c', "d'; DROP TABLE questions;--"])
    expect(qs[1].options).toBeUndefined()
    expect(store.listQuestions(other.id)).toEqual([])
  })

  it('registra intentos con sus respuestas', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const other = store.createSubject('Otra')
    const d = store.addDocument({ subjectId: s.id, title: 'd', sourceType: 'text' })
    const [c] = store.addChunks(d.id, s.id, ['texto'])
    const q = store.saveQuestion({
      subjectId: s.id, chunkId: c.id, type: 'vf', prompt: 'p', answer: 'V', explanation: 'e', quote: 'texto'
    })
    const attemptId = store.startAttempt(s.id)
    store.saveAnswer({
      attemptId, questionId: q.id!, userAnswer: 'F', correct: false, feedback: 'mal', feedbackQuote: 'texto'
    })
    let [attempt] = store.listAttempts(s.id)
    expect(attempt.id).toBe(attemptId)
    expect(attempt.subjectId).toBe(s.id)
    expect(attempt.finishedAt).toBeNull()
    expect(attempt.answers).toEqual([
      expect.objectContaining({
        attemptId, questionId: q.id, userAnswer: 'F', correct: false, feedback: 'mal', feedbackQuote: 'texto'
      })
    ])
    store.finishAttempt(attemptId)
    ;[attempt] = store.listAttempts(s.id)
    expect(attempt.finishedAt).not.toBeNull()
    expect(store.listAttempts(other.id)).toEqual([])
  })

  it('persiste a disco y reabre con los mismos datos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-test-'))
    const file = join(dir, 'datos.sqlite')
    try {
      const store = await openStore(file)
      const s = store.createSubject('Persistente')
      const d = store.addDocument({ subjectId: s.id, title: 'd', sourceType: 'text' })
      const [c] = store.addChunks(d.id, s.id, ['sobrevive'])
      store.saveQuestion({
        subjectId: s.id, chunkId: c.id, type: 'test', prompt: 'p', options: ['x', 'y'],
        answer: 'x', explanation: 'e', quote: 'sobrevive'
      })
      // sql.js reinicia foreign_keys al exportar: el cascade debe seguir funcionando tras escribir
      const extra = store.addDocument({ subjectId: s.id, title: 'extra', sourceType: 'text' })
      store.addChunks(extra.id, s.id, ['efímero'])
      store.deleteDocument(extra.id)
      expect(store.listChunks(s.id).map((x) => x.text)).toEqual(['sobrevive'])
      expect(existsSync(file)).toBe(true)
      expect(readdirSync(dir)).toEqual(['datos.sqlite']) // sin temporales residuales

      const reopened = await openStore(file)
      expect(reopened.listSubjects().map((x) => x.name)).toEqual(['Persistente'])
      expect(reopened.listChunks(s.id).map((x) => x.text)).toEqual(['sobrevive'])
      expect(reopened.listQuestions(s.id)[0].options).toEqual(['x', 'y'])
      // las claves foráneas siguen activas tras reabrir
      reopened.deleteDocument(d.id)
      expect(reopened.listChunks(s.id)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
