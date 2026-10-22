// __GT_DEV_MOCK__ — marcador para verificar que este archivo NO llega al paquete de producción.
// `window.api` falso en memoria para previsualizar la interfaz en un navegador normal (solo `vite dev`).
import type { Api, Chunk, DocumentInfo, ImportKind, Result, Subject } from '../../shared/api'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string, code?: 'NOT_FOUND' | 'NO_TEXT' | 'WOULD_DELETE_QUESTIONS' | 'INVALID', count?: number): Result<never> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
  ...(count !== undefined ? { count } : {})
})

const SAMPLE = [
  'La célula es la unidad básica estructural y funcional de los seres vivos. Todos los organismos están formados por una o más células.',
  'La membrana plasmática delimita la célula y regula el intercambio de sustancias con el exterior mediante transporte pasivo y activo.',
  'Texto de prueba con marcado, que debe verse literal y no ejecutarse: <img src=x onerror=alert(1)> y <b>no negrita</b>.',
  'Las mitocondrias producen la mayor parte del ATP mediante la respiración celular. Se consideran las centrales energéticas de la célula.'
]

export function createDevMockApi(): Api {
  let nextId = 100
  const startedAt = Date.now()
  let pdfCalls = 0
  let imageCalls = 0
  const subjects: Subject[] = [{ id: 1, name: 'Biología' }]
  const docs: DocumentInfo[] = []
  const chunks: Chunk[] = []
  const questionsByDoc = new Map<number, number>()

  const addDoc = (subjectId: number, title: string, sourceType: ImportKind, texts: string[]): DocumentInfo => {
    const d: DocumentInfo = { id: nextId++, subjectId, title, sourceType, chunkCount: 0 }
    docs.push(d)
    setChunks(d, texts)
    return d
  }
  const setChunks = (d: DocumentInfo, texts: string[]): void => {
    for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i]?.documentId === d.id) chunks.splice(i, 1)
    texts.forEach((text, position) => chunks.push({ id: nextId++, documentId: d.id, subjectId: d.subjectId, position, text }))
    d.chunkCount = texts.length
  }

  return {
    subjects: {
      list: async () => ok([...subjects]),
      create: async (name) => {
        await delay(150)
        const clean = name.trim()
        if (!clean) return fail('El nombre no puede estar vacío', 'INVALID')
        if (subjects.some((s) => s.name.toLowerCase() === clean.toLowerCase())) return fail('Ya existe una asignatura con ese nombre', 'INVALID')
        const s = { id: nextId++, name: clean }
        subjects.push(s)
        return ok(s)
      }
    },
    notes: {
      import: async (subjectId, kind) => {
        await delay(kind === 'image' ? 1500 : 500)
        if (kind === 'text') return ok({ canceled: false as const, kind, document: addDoc(subjectId, 'apuntes-ejemplo.md', 'text', SAMPLE) })
        if (kind === 'pdf') {
          // Alterna: la primera vez simula un PDF escaneado (NO_TEXT), después uno con texto.
          if (pdfCalls++ % 2 === 0) return fail('El PDF no contiene texto', 'NO_TEXT')
          return ok({ canceled: false as const, kind, document: addDoc(subjectId, 'apuntes.pdf', 'pdf', SAMPLE.slice(0, 2)) })
        }
        const d = addDoc(subjectId, 'foto-apuntes.png', 'image', [])
        // Desde la segunda foto, el documento "ya tiene preguntas" para probar WOULD_DELETE_QUESTIONS.
        if (imageCalls++ > 0) questionsByDoc.set(d.id, 3)
        return ok({ canceled: false as const, kind, documentId: d.id, ocrText: 'La celula es la unidad basica de los seres vivos.\nLa membrana plasmatica regula el intercambio' })
      },
      confirmOcr: async (documentId, correctedText, force) => {
        await delay(400)
        const d = docs.find((x) => x.id === documentId)
        if (!d) return fail('Documento no encontrado', 'NOT_FOUND')
        const questions = questionsByDoc.get(documentId) ?? 0
        if (questions > 0 && !force) return fail('Se borrarían preguntas guardadas', 'WOULD_DELETE_QUESTIONS', questions)
        questionsByDoc.delete(documentId)
        setChunks(d, correctedText.split(/\n{1,}/).map((t) => t.trim()).filter(Boolean))
        return ok({ documentId, chunkCount: d.chunkCount, deletedQuestions: questions })
      },
      list: async (subjectId) => ok(docs.filter((d) => d.subjectId === subjectId).map((d) => ({ ...d }))),
      chunks: async (subjectId, documentId) => ok(chunks.filter((c) => c.subjectId === subjectId && (documentId === undefined || c.documentId === documentId))),
      chunk: async (subjectId, chunkId) => {
        const c = chunks.find((x) => x.id === chunkId && x.subjectId === subjectId)
        if (!c) return fail('Fragmento no encontrado', 'NOT_FOUND')
        const documentTitle = docs.find((d) => d.id === c.documentId)?.title ?? ''
        return ok({ id: c.id, documentId: c.documentId, documentTitle, position: c.position, text: c.text })
      },
      deleteDocument: async (subjectId, documentId) => {
        const i = docs.findIndex((d) => d.id === documentId && d.subjectId === subjectId)
        if (i < 0) return fail('Documento no encontrado', 'NOT_FOUND')
        docs.splice(i, 1)
        for (let j = chunks.length - 1; j >= 0; j--) if (chunks[j]?.documentId === documentId) chunks.splice(j, 1)
        return ok(null)
      }
    },
    quiz: {
      generate: async () => fail('No disponible en la vista previa'),
      cancel: async () => ok({ cancelled: false }),
      onProgress: () => () => {},
      startAttempt: async () => fail('No disponible en la vista previa'),
      finishAttempt: async () => ok(null),
      submit: async () => fail('No disponible en la vista previa')
    },
    history: { list: async () => ok([]) },
    system: {
      // Ollama aparece caído durante los primeros 4 s tras cargar (React StrictMode llama dos veces al montar,
      // así que no sirve contar llamadas); después, "Reintentar" lo encuentra listo.
      health: async () => {
        await delay(300)
        return Date.now() - startedAt < 4000
          ? ok({ ok: false, message: 'No se pudo conectar con Ollama en http://localhost:11434.', model: 'qwen2.5:7b' })
          : ok({ ok: true, message: 'Ollama listo', model: 'qwen2.5:7b' })
      },
      config: async () => ok({ model: 'qwen2.5:7b' })
    }
  }
}

export const DEV_MOCK_MARKER = '__GT_DEV_MOCK__'

export function installDevMock(): void {
  window.api = createDevMockApi()
  console.info(`[${DEV_MOCK_MARKER}] window.api simulado en memoria (solo desarrollo, sin Electron)`)
}
