import { vi } from 'vitest'
import type { GenerateOutcome, GradeResultDto, ProgressEvent, Question } from '../../src/shared/api'

export const XSS = '<img src=x onerror=alert(1)>'

export const vfQ = (over: Partial<Question> = {}): Question => ({
  id: 1,
  subjectId: 7,
  chunkId: 11,
  type: 'vf',
  prompt: 'La célula es la unidad básica de los seres vivos.',
  answer: 'verdadero',
  explanation: 'Está en el fragmento.',
  quote: 'La célula es la unidad básica',
  ...over
})

export const testQ = (over: Partial<Question> = {}): Question => ({
  id: 2,
  subjectId: 7,
  chunkId: 12,
  type: 'test',
  prompt: '¿Qué estructura regula el intercambio?',
  options: ['El núcleo', 'La membrana', 'El ribosoma', 'El citoplasma'],
  answer: 'La membrana',
  explanation: 'La membrana regula.',
  quote: 'La membrana regula el intercambio',
  ...over
})

export const devQ = (over: Partial<Question> = {}): Question => ({
  id: 3,
  subjectId: 7,
  chunkId: 13,
  type: 'desarrollo',
  prompt: 'Explica qué hacen las mitocondrias.',
  answer: 'Producen ATP.',
  explanation: 'Producen ATP.',
  quote: 'Las mitocondrias producen ATP',
  ...over
})

export const grade = (over: Partial<GradeResultDto> = {}): GradeResultDto => ({
  correct: true,
  feedback: 'Correcto. Está en el fragmento.',
  quote: 'La célula es la unidad básica',
  verified: true,
  ...over
})

export const outcome = (questions: Question[], over: Partial<GenerateOutcome> = {}): GenerateOutcome => ({
  questions,
  discarded: 0,
  reasons: [],
  insufficient: false,
  ...over
})

export const okR = <T>(data: T) => Promise.resolve({ ok: true as const, data })
export const failR = (error: string) => Promise.resolve({ ok: false as const, error })

/** Control manual de `onProgress` y de una generación que se resuelve a mano. */
export function progressHarness() {
  const listeners = new Set<(e: ProgressEvent) => void>()
  return {
    onProgress: vi.fn((cb: (e: ProgressEvent) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    emit: (e: ProgressEvent) => listeners.forEach((cb) => cb(e)),
    listeners
  }
}

export function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
