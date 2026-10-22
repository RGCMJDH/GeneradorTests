export interface LlmProvider {
  generateJson(p: { system: string; user: string; signal?: AbortSignal }): Promise<unknown>
  health(): Promise<{ ok: boolean; message: string }>
}

const DEFAULT_BASE_URL = 'http://localhost:11434'
const DEFAULT_MODEL = 'qwen2.5:7b'
const DEFAULT_HEALTH_TIMEOUT_MS = 3000

/** Devuelve el índice (inclusive) donde cierra el valor JSON que empieza en `start`, o -1. */
function findBalancedEnd(text: string, start: number): number {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/**
 * Extrae el JSON de una respuesta de LLM. Orden:
 * 1) toda la respuesta; 2) el contenido de un bloque ``` / ```json;
 * 3) el primer candidato balanceado que empieza en `{` (si no hay ninguna `{`,
 *    en `[`). Un candidato truncado (sin cerrar) lanza error: nunca se descarta
 *    hacia un fragmento interno. Si un candidato `{...}` está balanceado pero no
 *    es JSON (llaves sueltas en la prosa), se salta entero y se prueba el
 *    siguiente `{` posterior. Con `{}` o `[]` en la prosa antes del objeto real,
 *    gana el primero. Lanza Error si no hay JSON válido.
 */
export function extractJson(raw: string): unknown {
  const text = typeof raw === 'string' ? raw : ''

  const whole = tryParse(text.trim())
  if (whole.ok) return whole.value

  const fence = /```(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i.exec(text)
  if (fence) {
    const inFence = tryParse(fence[1].trim())
    if (inFence.ok) return inFence.value
  }

  const open = text.includes('{') ? '{' : '['
  let from = 0
  for (;;) {
    const start = text.indexOf(open, from)
    if (start === -1) break
    const end = findBalancedEnd(text, start)
    if (end === -1) break // truncado: no descender a fragmentos internos
    const parsed = tryParse(text.slice(start, end + 1))
    if (parsed.ok) return parsed.value
    from = end + 1 // balanceado pero no JSON: saltarlo entero
  }

  const preview = text.trim().slice(0, 80)
  throw new Error(
    `La respuesta del modelo no contiene JSON válido${preview ? `: «${preview}»` : ' (respuesta vacía)'}.`
  )
}

export class OllamaProvider implements LlmProvider {
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(opts?: { baseUrl?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.baseUrl = (opts?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.model = opts?.model ?? DEFAULT_MODEL
    this.fetchImpl = opts?.fetchImpl ?? ((...args) => fetch(...args))
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  }

  async generateJson(p: { system: string; user: string; signal?: AbortSignal }): Promise<unknown> {
    const cancelled = () => new Error('Se ha cancelado la generación con Ollama.')
    if (p.signal?.aborted) throw cancelled()
    const isAbort = (e: unknown) =>
      p.signal?.aborted === true || (e instanceof Error && e.name === 'AbortError')
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: p.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: p.user }
          ],
          stream: false,
          format: 'json',
          options: { temperature: 0.2 }
        })
      })
    } catch (e) {
      if (isAbort(e)) throw cancelled()
      throw new Error(
        `No se pudo conectar con Ollama en ${this.baseUrl}. Comprueba que esté en ejecución (ollama serve). Detalle: ${errMsg(e)}`
      )
    }
    if (!res.ok) {
      const detail = await safeText(res)
      const hint =
        res.status === 404
          ? ` Comprueba que el modelo ${this.model} esté instalado (ollama pull ${this.model}).`
          : ''
      throw new Error(`Ollama respondió con error ${res.status}${detail ? `: ${detail}` : ''}.${hint}`)
    }
    let data: unknown
    try {
      data = await res.json()
    } catch (e) {
      if (isAbort(e)) throw cancelled()
      throw new Error('Ollama devolvió una respuesta que no se puede leer.')
    }
    const content = (data as { message?: { content?: unknown } } | null)?.message?.content
    if (typeof content !== 'string') {
      throw new Error('Ollama devolvió una respuesta sin contenido del modelo.')
    }
    return extractJson(content)
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    const notRunning = {
      ok: false,
      message: `No se puede conectar con Ollama en ${this.baseUrl}. Arráncalo con «ollama serve» o instálalo desde https://ollama.com.`
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let res: Response
      try {
        res = await this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: controller.signal })
      } catch {
        return notRunning
      }
      if (!res.ok) {
        return {
          ok: false,
          message: `Ollama respondió con error ${res.status} al comprobar los modelos. Reinícialo con «ollama serve».`
        }
      }
      let data: { models?: Array<{ name?: unknown; model?: unknown }> }
      try {
        data = (await res.json()) as typeof data
      } catch {
        return notRunning
      }
      const names = (data?.models ?? [])
        .map((m) => (typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : ''))
        .filter(Boolean)
      if (!hasModel(names, this.model)) {
        return {
          ok: false,
          message: `Ollama está en marcha pero falta el modelo ${this.model}. Descárgalo con: ollama pull ${this.model}`
        }
      }
      return { ok: true, message: `Ollama listo con el modelo ${this.model}.` }
    } catch {
      return notRunning
    } finally {
      clearTimeout(timer)
    }
  }
}

function hasModel(names: string[], model: string): boolean {
  if (names.includes(model)) return true
  // Sin etiqueta (p. ej. "llama3"): Ollama la resuelve a "llama3:latest".
  return !model.includes(':') && names.includes(`${model}:latest`)
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).trim().slice(0, 200)
  } catch {
    return ''
  }
}
