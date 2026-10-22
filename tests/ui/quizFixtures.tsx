import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TestTab from '../../src/renderer/src/views/TestTab'
import { doc, installApi } from './fakeApi'
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

export const practicoQ = (over: Partial<Question> = {}): Question => ({
  id: 4,
  subjectId: 7,
  chunkId: 14,
  type: 'practico',
  prompt: 'Una resistencia de 10 ohmios recorrida por 2 amperios: ¿qué tensión hay en sus extremos?',
  answer: 'V = I · R = 2 · 10 = 20 voltios',
  explanation: 'Ley de Ohm.',
  quote: 'V = I · R = 2 · 10 = 20 voltios',
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

export const okR = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
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

/** Monta TestTab, genera con las preguntas dadas y empieza el intento. `submit` es la implementación de quiz.submit. */
export async function beginQuiz(questions: Question[], submit: (...a: never[]) => unknown, extra: Record<string, unknown> = {}) {
  const api = installApi({
    notes: { list: vi.fn(() => okR([doc()])) },
    quiz: {
      generate: vi.fn(() => okR(outcome(questions))),
      startAttempt: vi.fn(() => okR({ attemptId: 5 })),
      finishAttempt: vi.fn(() => okR(null)),
      submit: vi.fn(submit),
      ...extra
    } as never
  })
  const onShowHistory = vi.fn()
  const view = render(<TestTab subject={{ id: 7, name: 'Biología' }} onShowHistory={onShowHistory} />)
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
  await screen.findByRole('heading', { name: /^Pregunta 1 de/ })
  return { api, onShowHistory, view }
}
