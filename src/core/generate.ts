import type { Chunk, Question, QuestionType } from './types'
import type { LlmProvider } from './llm'
import type { Store } from './store'
import { normalize } from './normalize'
import { verifyQuote } from './verify'

export interface GenerateRequest {
  subjectId: number
  type: QuestionType
  count: number
  documentId?: number
  topic?: string
}

export interface GenerateResult {
  questions: Question[]
  discarded: number
  reasons: string[]
  insufficient: boolean
}

const MAX_RETRIES = 2
const NO_MATERIAL = 'sin material suficiente'

// ---------------------------------------------------------------- prompts

const SYSTEM_PROMPT = [
  'Eres un generador de preguntas de estudio. Respondes siempre en español.',
  'Usa solo el texto dado: no añadas datos, ejemplos ni conocimientos que no aparezcan en él.',
  'La "cita" debe ser una copia exacta y literal de un pasaje del texto (sin cambiar palabras, sin resumir, sin traducir).',
  'Si el texto no permite formular una pregunta con base suficiente, responde exactamente {"sin_material":true}.',
  'Responde únicamente con un objeto JSON, sin explicaciones, sin comentarios y sin bloques de código.'
].join('\n')

const TYPE_INSTRUCTIONS: Record<QuestionType, string> = {
  vf: 'una afirmación de verdadero o falso. "enunciado" es la afirmación; "respuesta" es exactamente "verdadero" o "falso".',
  test: 'una pregunta tipo test. "opciones" es un array de exactamente 4 textos distintos; "respuesta" es el texto exacto de la opción correcta.',
  desarrollo: 'una pregunta de desarrollo. "respuesta" es la respuesta modelo, basada solo en el texto.',
  practico: 'un ejercicio práctico. "respuesta" es la solución, basada solo en el texto.'
}

const FORMAT_FIELDS = (type: QuestionType): string =>
  type === 'test'
    ? '{"enunciado": "...", "opciones": ["...", "...", "...", "..."], "respuesta": "...", "explicacion": "...", "chunkId": <número>, "cita": "..."}'
    : '{"enunciado": "...", "respuesta": "...", "explicacion": "...", "chunkId": <número>, "cita": "..."}'

function buildUserPrompt(type: QuestionType, chunk: Chunk, previous: string[]): string {
  const lines = [
    `Genera ${TYPE_INSTRUCTIONS[type]}`,
    `Formato de salida: ${FORMAT_FIELDS(type)}`,
    `"chunkId" debe ser ${chunk.id} y "cita" debe copiarse literalmente del texto.`,
    '"explicacion" justifica la respuesta apoyándose en el texto.'
  ]
  if (previous.length > 0) {
    lines.push('No repitas estas preguntas ya generadas:', ...previous.map((p) => `- ${p}`))
  }
  lines.push('', `Fragmento (chunkId ${chunk.id}):`, '"""', chunk.text, '"""')
  return lines.join('\n')
}

// ------------------------------------------------------------- validación

type Parsed = { ok: true; value: Omit<Question, 'id' | 'subjectId'> } | { ok: false; reason: string }

const fail = (reason: string): Parsed => ({ ok: false, reason })
const isStr = (v: unknown): v is string => typeof v === 'string'

/** Valida la forma de la respuesta del modelo; no confía en nada. La cita se verifica aparte. */
function parseResponse(raw: unknown, type: QuestionType, sentChunkId: number): Parsed {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail('respuesta no es un objeto JSON')
  const o = raw as Record<string, unknown>
  if (o.sin_material === true) return fail('sin material')
  if (!isStr(o.enunciado) || o.enunciado.trim() === '') return fail('falta el enunciado')
  if (!isStr(o.respuesta)) return fail('falta la respuesta')
  if (!isStr(o.explicacion)) return fail('falta la explicación')
  if (typeof o.chunkId !== 'number' || !Number.isInteger(o.chunkId)) return fail('chunkId no es un entero')
  if (!isStr(o.cita)) return fail('falta la cita')
  if (o.chunkId !== sentChunkId) return fail(`chunkId ${o.chunkId} no es el fragmento enviado`)

  const base = {
    chunkId: o.chunkId,
    type,
    prompt: o.enunciado.trim(),
    explanation: o.explicacion.trim(),
    quote: o.cita.trim()
  }
  const answer = o.respuesta.trim()

  if (type === 'vf') {
    const a = normalize(answer)
    if (a !== 'verdadero' && a !== 'falso') return fail('la respuesta de verdadero/falso no es "verdadero" ni "falso"')
    return { ok: true, value: { ...base, answer: a } }
  }
  if (type === 'test') {
    const opts = o.opciones
    if (!Array.isArray(opts) || opts.length !== 4 || !opts.every((x) => isStr(x) && x.trim() !== ''))
      return fail('el test necesita exactamente 4 opciones no vacías')
    const options = (opts as string[]).map((x) => x.trim())
    if (new Set(options.map(normalize)).size !== 4) return fail('las opciones del test están repetidas')
    const match = options.find((x) => x === answer) ?? options.find((x) => normalize(x) === normalize(answer))
    if (match === undefined) return fail('la respuesta no coincide con ninguna opción')
    return { ok: true, value: { ...base, options, answer: match } }
  }
  // desarrollo (y practico, provisionalmente igual; su filtro numérico llega en otra tarea)
  if (answer === '') return fail('la respuesta está vacía')
  return { ok: true, value: { ...base, answer } }
}

// ------------------------------------------------------------- generación

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function selectChunks(store: Store, req: GenerateRequest): Chunk[] {
  let chunks = store.listChunks(req.subjectId, req.documentId).filter((c) => c.subjectId === req.subjectId)
  const topic = req.topic ? normalize(req.topic) : ''
  if (topic) chunks = chunks.filter((c) => normalize(c.text).includes(topic))
  return chunks
}

export async function generateQuestions(
  deps: { llm: LlmProvider; store: Store },
  req: GenerateRequest,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<GenerateResult> {
  const { llm, store } = deps
  const chunks = selectChunks(store, req)
  if (chunks.length === 0) {
    return { questions: [], discarded: 0, reasons: [NO_MATERIAL], insufficient: true }
  }

  const total = Math.max(0, Math.floor(req.count))
  const questions: Question[] = []
  const reasons: string[] = []
  const previous: string[] = []
  let discarded = 0
  let aborted = false

  for (let i = 0; i < total && !aborted; i++) {
    // Rotación: las preguntas se reparten por el material. Un único fragmento por prompt.
    const chunk = chunks[i % chunks.length]
    const user = buildUserPrompt(req.type, chunk, previous)
    let reason = 'sin intentos'
    let saved: Question | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        aborted = true
        break
      }
      let raw: unknown
      try {
        raw = await llm.generateJson({ system: SYSTEM_PROMPT, user, signal })
      } catch (e) {
        if (signal?.aborted) {
          aborted = true
          break
        }
        reason = `error del modelo: ${errText(e)}`
        continue
      }
      if (signal?.aborted) {
        aborted = true
        break
      }
      const parsed = parseResponse(raw, req.type, chunk.id)
      if (!parsed.ok) {
        reason = parsed.reason
        continue
      }
      // La cita se verifica contra el texto guardado en el store, nunca contra texto del modelo.
      const stored = store.getChunk(parsed.value.chunkId)
      if (!stored || stored.subjectId !== req.subjectId || !verifyQuote(parsed.value.quote, stored.text)) {
        reason = 'la cita no aparece literalmente en el fragmento'
        continue
      }
      saved = store.saveQuestion({ subjectId: req.subjectId, ...parsed.value })
      break
    }

    if (aborted) break
    if (saved) {
      questions.push(saved)
      previous.push(saved.prompt)
    } else {
      discarded++
      reasons.push(reason)
    }
    onProgress?.(i + 1, total)
  }

  return { questions, discarded, reasons, insufficient: !aborted && questions.length === 0 }
}
