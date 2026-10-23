// __GT_DEV_MOCK__ — marcador para verificar que este archivo NO llega al paquete de producción.
// `window.api` falso en memoria para previsualizar la interfaz en un navegador normal (solo `vite dev`).
import type { Api, Chunk, Concept, DocumentInfo, GenerateOutcome, GenerateRequestDto, GradeResultDto, HistoryAttempt, ImportKind, MobileImageEvent, MobileStoppedEvent, Question, Result, Subject } from '../../shared/api'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const ok = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (error: string, code?: 'NOT_FOUND' | 'NO_TEXT' | 'WOULD_DELETE_QUESTIONS' | 'INVALID', count?: number): Result<never> => ({
  ok: false,
  error,
  ...(code ? { code } : {}),
  ...(count !== undefined ? { count } : {})
})

/** PNG de 1x1 como QR de relleno: en el simulador no hay red ni servidor. */
const MOCK_QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const SAMPLE = [
  'La célula es la unidad básica estructural y funcional de los seres vivos. Todos los organismos están formados por una o más células.',
  'La membrana plasmática delimita la célula y regula el intercambio de sustancias con el exterior mediante transporte pasivo y activo.',
  'Texto de prueba con marcado, que debe verse literal y no ejecutarse: <img src=x onerror=alert(1)> y <b>no negrita</b>.',
  'Las mitocondrias producen la mayor parte del ATP mediante la respiración celular. Se consideran las centrales energéticas de la célula.'
]

// Fragmento con datos y método resueltos: es el que da material de verdad a los ejercicios prácticos del simulador.
const OHM_EXAMPLE = 'Ejemplo resuelto: una resistencia de 10 ohmios recorrida por una corriente de 2 amperios. Por la ley de Ohm, V = I · R = 2 · 10 = 20 voltios.'
const OHM_QUOTE = 'Por la ley de Ohm, V = I · R = 2 · 10 = 20 voltios.'
SAMPLE.push(OHM_EXAMPLE)
// Mismo criterio que el núcleo: dígito, «=» o una palabra de ejercicio/fórmula.
const hasExerciseMaterial = (t: string): boolean =>
  /[\d=]/.test(t) || /\b(ejemplo|ejercicio|problema|formula|calcula)/.test(t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase())

// Vocabulario del simulador de conceptos: solo se «extrae» lo que aparece literalmente en un fragmento (como el núcleo real).
const CONCEPT_VOCAB = ['célula', 'membrana plasmática', 'mitocondrias', 'ATP', 'respiración celular', 'ley de Ohm', 'seres vivos', '<img src=x onerror=alert(1)>']
const norm = (t: string): string => t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const hasTerm = (text: string, term: string): boolean => ` ${norm(text)} `.includes(` ${norm(term)} `)

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
  // Términos por fragmento (lo que «extrajo» el simulador); el índice se deriva de aquí, así que un documento concreto se mezcla solo.
  const chunkTerms = new Map<number, string[]>()
  const indexOf = (subjectId: number): Concept[] => {
    const byTerm = new Map<string, Concept>()
    for (const c of chunks.filter((x) => x.subjectId === subjectId)) {
      const terms = chunkTerms.get(c.id) ?? []
      for (const term of terms) {
        const k = byTerm.get(term) ?? { term, chunkIds: [], related: [] }
        k.chunkIds.push(c.id)
        k.related = [...new Set([...k.related, ...terms.filter((t) => t !== term)])].sort((a, b) => a.localeCompare(b, 'es'))
        byTerm.set(term, k)
      }
    }
    return [...byTerm.values()].sort((a, b) => b.chunkIds.length - a.chunkIds.length || a.term.localeCompare(b.term, 'es'))
  }
  const conceptListeners = new Set<(e: { requestId: string; done: number; total: number }) => void>()

  // Subida desde el móvil simulada: sin servidor ni red. A los 8 s «llega» una foto y luego otra cada 15 s mientras siga activa.
  const photoListeners = new Set<(e: MobileImageEvent) => void>()
  const stoppedListeners = new Set<(e: MobileStoppedEvent) => void>()
  let mobileTimers: ReturnType<typeof setTimeout>[] = []
  const stopMobile = (): void => {
    mobileTimers.forEach(clearTimeout)
    mobileTimers = []
  }
  const simulatePhoto = (subjectId: number, n: number): void => {
    const d = addDoc(subjectId, `foto-movil-${n.toString(16).padStart(8, '0')}`, 'image', [])
    const ocrText = 'La celula es la unidad basica de los seres vivos.\nLa membrana plasmatica regula el intercambio'
    photoListeners.forEach((cb) => cb({ subjectId, documentId: d.id, ocrText }))
    mobileTimers.push(setTimeout(() => simulatePhoto(subjectId, n + 1), 15_000))
  }

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

  // Simula la generación de ejercicios prácticos: máx. 2, con cita literal que contiene los datos y el método.
  const generatePractical = async (req: GenerateRequestDto, pool: Chunk[]): Promise<Result<GenerateOutcome>> => {
    const topic = req.topic?.trim().toLowerCase() ?? ''
    const candidates = pool.filter((c) => hasExerciseMaterial(c.text) && (topic === '' || c.text.toLowerCase().includes(topic)))
    candidates.sort((x, y) => Number(y.text === OHM_EXAMPLE) - Number(x.text === OHM_EXAMPLE))
    if (topic.includes('poesía') || candidates.length === 0) {
      await delay(500)
      return ok({ questions: [], discarded: 0, reasons: ['sin material suficiente para ejercicios prácticos'], insufficient: true })
    }
    cancelled.delete(req.requestId)
    const made = Math.min(req.count, candidates.length, 2)
    const out: Question[] = []
    for (let i = 0; i < made; i++) {
      await delay(900)
      listeners.forEach((cb) => cb({ requestId: req.requestId, done: i, total: req.count }))
      if (cancelled.has(req.requestId)) break
      const c = candidates[i] as Chunk
      const ohm = c.text === OHM_EXAMPLE
      const quote = ohm ? OHM_QUOTE : (c.text.split(/(?<=\.)\s/)[0] ?? c.text)
      const q: Question = {
        id: nextId++,
        subjectId: req.subjectId,
        chunkId: c.id,
        type: 'practico',
        prompt: ohm
          ? 'Una resistencia de 10 ohmios recorrida por una corriente de 2 amperios: ¿qué tensión hay entre sus extremos? Resuélvelo con el método de tus apuntes.'
          : `Resuelve con los datos de tus apuntes: «${quote.split(' ').slice(0, 10).join(' ')}…»`,
        answer: ohm ? 'V = I · R = 2 · 10 = 20 voltios' : quote,
        explanation: 'Los datos y el método están en el fragmento citado.',
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
      reasons: Array.from({ length: dropped }, (_, k) => `Ejercicio ${made + k + 1}: la cita no aparece literalmente en el fragmento`),
      insufficient: false
    })
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
      // Ejercicios prácticos (type 'practico'): solo con fragmentos con datos/ejemplos; el tema «poesía» no tiene → sin material.
      generate: async (req) => {
        const pool = chunks.filter((c) => c.subjectId === req.subjectId && (req.documentId === undefined || c.documentId === req.documentId))
        if (req.type === 'practico') return generatePractical(req, pool)
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
        await delay(question(questionId)?.type === 'desarrollo' || question(questionId)?.type === 'practico' ? 1200 : 200)
        const q = question(questionId)
        const a = attempts.find((x) => x.id === attemptId)
        if (!q || !a) return fail('La pregunta o el intento no existe', 'NOT_FOUND')
        let res: GradeResultDto
        if (q.type === 'desarrollo' || q.type === 'practico') {
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
    concepts: {
      list: async (subjectId) => ok(indexOf(subjectId)),
      // Un fragmento cada 700 ms con progreso; «Cancelar» devuelve lo parcial sin guardarlo (igual que main).
      // Con documentId solo analiza ese documento y el resultado se mezcla con el índice.
      build: async ({ requestId, subjectId, documentId }) => {
        cancelled.delete(requestId)
        const pool = chunks.filter((c) => c.subjectId === subjectId && (documentId === undefined || c.documentId === documentId))
        const found = new Map<number, string[]>()
        for (let i = 0; i < pool.length; i++) {
          await delay(700)
          if (cancelled.has(requestId)) break
          const c = pool[i] as Chunk
          found.set(c.id, CONCEPT_VOCAB.filter((t) => hasTerm(c.text, t)))
          conceptListeners.forEach((cb) => cb({ requestId, done: i + 1, total: pool.length }))
        }
        const wasCancelled = cancelled.has(requestId)
        if (!wasCancelled) found.forEach((terms, id) => chunkTerms.set(id, terms))
        const concepts = wasCancelled ? indexOf(subjectId).filter((c) => c.chunkIds.some((id) => found.has(id))) : indexOf(subjectId)
        return ok({ concepts, cancelled: wasCancelled, analyzed: found.size, total: pool.length, failed: 0 })
      },
      cancel: async (requestId) => {
        cancelled.add(requestId)
        return ok({ cancelled: true })
      },
      onProgress: (cb) => {
        conceptListeners.add(cb)
        return () => conceptListeners.delete(cb)
      }
    },
    mobile: {
      start: async ({ subjectId }) => {
        await delay(300)
        stopMobile()
        mobileTimers.push(setTimeout(() => simulatePhoto(subjectId, 1), 8_000))
        mobileTimers.push(
          setTimeout(() => {
            stopMobile()
            stoppedListeners.forEach((cb) => cb({ reason: 'expired' }))
          }, 10 * 60_000)
        )
        return ok({ url: 'http://192.168.1.40:5173/u/0123456789abcdef0123456789abcdef', qrDataUrl: MOCK_QR, expiresAt: Date.now() + 10 * 60_000 })
      },
      stop: async () => {
        stopMobile()
        return ok(null)
      },
      onImage: (cb) => {
        photoListeners.add(cb)
        return () => photoListeners.delete(cb)
      },
      onStopped: (cb) => {
        stoppedListeners.add(cb)
        return () => stoppedListeners.delete(cb)
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
