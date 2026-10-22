import { vi } from 'vitest'
import type { Api, DocumentInfo } from '../../src/shared/api'

type Over = { [K in keyof Api]?: Partial<Api[K]> }

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data })

/** `window.api` falso con todos los métodos como vi.fn; `over` sustituye métodos concretos. */
export function installApi(over: Over = {}): Api {
  const api: Api = {
    subjects: {
      list: vi.fn(() => ok([])),
      create: vi.fn((name: string) => ok({ id: 1, name })),
      ...over.subjects
    },
    notes: {
      import: vi.fn(() => ok({ canceled: true as const })),
      confirmOcr: vi.fn((documentId: number) => ok({ documentId, chunkCount: 1, deletedQuestions: 0 })),
      list: vi.fn(() => ok([])),
      chunks: vi.fn(() => ok([])),
      chunk: vi.fn(() => Promise.resolve({ ok: false as const, error: 'No existe', code: 'NOT_FOUND' as const })),
      deleteDocument: vi.fn(() => ok(null)),
      ...over.notes
    },
    quiz: {
      generate: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
      startAttempt: vi.fn(),
      finishAttempt: vi.fn(),
      submit: vi.fn(),
      ...over.quiz
    },
    history: { list: vi.fn(() => ok([])), ...over.history },
    concepts: {
      list: vi.fn(() => ok([])),
      build: vi.fn(() => ok({ concepts: [], cancelled: false, analyzed: 0, total: 0 })),
      cancel: vi.fn(() => ok({ cancelled: true })),
      onProgress: vi.fn(() => () => {}),
      ...over.concepts
    },
    system: {
      health: vi.fn(() => ok({ ok: true, message: 'Ollama listo', model: 'qwen2.5:7b' })),
      config: vi.fn(() => ok({ model: 'qwen2.5:7b' })),
      ...over.system
    }
  } as unknown as Api
  ;(window as unknown as { api: Api }).api = api
  return api
}

export const doc = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: 1,
  subjectId: 7,
  title: 'Apuntes de célula',
  sourceType: 'text',
  chunkCount: 3,
  ...over
})
