// __GT_DEV_MOCK__ — marcador para verificar que este archivo NO llega al paquete de producción.
// `window.api` falso en memoria para previsualizar la interfaz en un navegador normal (solo `vite dev`).
import type { Api, Chunk, DocumentInfo, GradeResultDto, HistoryAttempt, ImportKind, Question, Result, Subject } from '../../shared/api'

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
  // Estado del test simulado.
  const questionsById = new Map<number, Question>()
  const question = (id: number): Question | undefined => questionsById.get(id)
  const attempts: (HistoryAttempt & { subjectId: number })[] = []
  const listeners = new Set<(e: { requestId: string; done: number; total: number }) => void>()
  const cancelled = new Set<string>()

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
      // Genera (como mucho) 3 preguntas de tipos distintos con citas literales de los fragmentos de la asignatura.
      // Tema "física cuántica" → sin material. Con más de 3 preguntas pedidas, el resto sale como descartadas.
      generate: async (req) => {
        const pool = chunks.filter((c) => c.subjectId === req.subjectId && (req.documentId === undefined || c.documentId === req.documentId))
        if (req.topic?.toLowerCase().includes('física cuántica') || pool.length === 0) {
          await delay(500)
          return ok({ questions: [], discarded: 0, reasons: [], insufficient: true })
        }
        const kinds: Question['type'][] = ['vf', 'test', 'desarrollo']
        const made = Math.min(req.count, 3)
        const out: Question[] = []
        cancelled.delete(req.requestId)
        for (let i = 0; i < made; i++) {
          await delay(900)
          listeners.forEach((cb) => cb({ requestId: req.requestId, done: i, total: req.count }))
          if (cancelled.has(req.requestId)) break
          const c = pool[i % pool.length] as Chunk
          const type = kinds[i % kinds.length] as Question['type']
          // Cita literal = primera frase del fragmento (siempre es subcadena del texto).
          const quote = c.text.split(/(?<=\.)\s/)[0] ?? c.text
          const q: Question = {
            id: nextId++,
            subjectId: req.subjectId,
            chunkId: c.id,
            type,
            prompt:
              type === 'vf'
                ? quote
                : type === 'test'
                  ? 'Según tus apuntes, ¿qué afirmación es correcta?'
                  : `Explica con tus palabras lo que dicen tus apuntes sobre: «${quote.split(' ').slice(0, 8).join(' ')}…»`,
            ...(type === 'test' ? { options: ['Los apuntes no dicen nada sobre este tema.', quote, 'Esta afirmación es falsa en todos los casos.', 'Solo se aplica a las plantas.'] } : {}),
            answer: type === 'vf' ? 'verdadero' : quote,
            explanation: 'Se explica en el fragmento citado.',
            quote
          }
          questionsById.set(q.id as number, q)
          out.push(q)
        }
        if (!cancelled.has(req.requestId)) listeners.forEach((cb) => cb({ requestId: req.requestId, done: made, total: req.count }))
        const dropped = cancelled.has(req.requestId) ? 0 : req.count - made
        return ok({
          questions: out,
          discarded: dropped,
          reasons: Array.from({ length: dropped }, (_, k) => `Pregunta ${made + k + 1}: la cita no aparece literalmente en el fragmento`),
          insufficient: false
        })
      },
      cancel: async (requestId) => {
        cancelled.add(requestId)
        return ok({ cancelled: true })
      },
      onProgress: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      startAttempt: async (subjectId) => {
        const id = nextId++
        attempts.push({ id, subjectId, startedAt: new Date().toISOString(), finishedAt: null, answers: [] })
        return ok({ attemptId: id })
      },
      finishAttempt: async (_subjectId, attemptId) => {
        const a = attempts.find((x) => x.id === attemptId)
        if (a) a.finishedAt = new Date().toISOString()
        return ok(null)
      },
      // vf/test: corrección exacta con cita verificada. desarrollo: acierta si responde algo largo. Variantes (como el núcleo real):
      // "cita del modelo" → la cita del modelo no se verificó pero se muestra la guardada con la pregunta (verified:true + marcador);
      // "sin cita" → ni siquiera la cita guardada se pudo verificar (quote vacío, verified:false, marcador).
      submit: async ({ attemptId, questionId, answer }) => {
        await delay(question(questionId)?.type === 'desarrollo' ? 1200 : 200)
        const q = question(questionId)
        const a = attempts.find((x) => x.id === attemptId)
        if (!q || !a) return fail('La pregunta o el intento no existe', 'NOT_FOUND')
        let res: GradeResultDto
        if (q.type === 'desarrollo') {
          const low = answer.toLowerCase()
          const modelUnverified = low.includes('cita del modelo')
          const noQuote = !modelUnverified && low.includes('sin cita')
          const correct = answer.trim().length > 20
          res = {
            correct,
            feedback: (correct ? 'Tu respuesta recoge la idea principal del fragmento.' : 'Falta desarrollar la idea principal del fragmento.') + (modelUnverified || noQuote ? ' (cita del modelo no verificada)' : ''),
            quote: noQuote ? '' : q.quote,
            verified: !noQuote
          }
        } else {
          const correct = answer.trim().toLowerCase() === q.answer.trim().toLowerCase()
          res = { correct, feedback: `${correct ? 'Correcto.' : `Incorrecto. La respuesta correcta es: ${q.answer}.`} ${q.explanation}`, quote: q.quote, verified: true }
        }
        a.answers.push({ questionId, prompt: q.prompt, type: q.type, userAnswer: answer, correct: res.correct, feedback: res.feedback, feedbackQuote: res.quote })
        return ok(res)
      }
    },
    history: { list: async (subjectId) => ok(attempts.filter((a) => a.subjectId === subjectId).map(({ subjectId: _s, ...rest }) => ({ ...rest, answers: [...rest.answers] }))) },
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
