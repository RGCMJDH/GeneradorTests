import { vi } from 'vitest'
import type { Api, DocumentInfo, ImportItem } from '../../src/shared/api'

type Over = { [K in keyof Api]?: Partial<Api[K]> }

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data })

export const MOBILE_URL = `http://192.168.1.40:5555/u/${'a'.repeat(32)}`
/** PNG de 1x1: basta para que el <img> del QR tenga un data URL válido. */
export const QR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** notes.importMany que devuelve estos resultados por archivo. */
export const importResult = (...items: ImportItem[]) => vi.fn(() => ok({ canceled: false as const, items }))

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
      importMany: vi.fn(() => ok({ canceled: true as const })),
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
      build: vi.fn(() => ok({ concepts: [], cancelled: false, analyzed: 0, total: 0, failed: 0 })),
      cancel: vi.fn(() => ok({ cancelled: true })),
      onProgress: vi.fn(() => () => {}),
      ...over.concepts
    },
    mobile: {
      start: vi.fn(() => ok({ url: MOBILE_URL, qrDataUrl: QR_PNG, expiresAt: Date.now() + 600_000 })),
      stop: vi.fn(() => ok(null)),
      onImage: vi.fn(() => () => {}),
      onStopped: vi.fn(() => () => {}),
      ...over.mobile
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
