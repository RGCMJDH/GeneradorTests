export interface LlmProvider {
  generateJson(p: { system: string; user: string }): Promise<unknown>
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

/**
 * Extrae el primer objeto/array JSON válido de una respuesta de LLM, tolerando
 * texto antes/después y bloques ```json. Lanza Error si no hay JSON válido.
 */
export function extractJson(raw: string): unknown {
  const text = typeof raw === 'string' ? raw : ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c !== '{' && c !== '[') continue
    const end = findBalancedEnd(text, i)
    if (end === -1) continue
    try {
      return JSON.parse(text.slice(i, end + 1))
    } catch {
      // candidato no válido: seguir buscando
    }
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

  async generateJson(p: { system: string; user: string }): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      throw new Error(
        `No se pudo conectar con Ollama en ${this.baseUrl}. Comprueba que esté en ejecución (ollama serve). Detalle: ${errMsg(e)}`
      )
    }
    if (!res.ok) {
      const detail = await safeText(res)
      throw new Error(
        `Ollama respondió con error ${res.status}${detail ? `: ${detail}` : ''}. Comprueba que el modelo ${this.model} esté instalado (ollama pull ${this.model}).`
      )
    }
    let data: unknown
    try {
      data = await res.json()
    } catch {
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
  // Sin etiqueta (p. ej. "llama3"): vale cualquier "llama3:<tag>".
  return !model.includes(':') && names.some((n) => n.startsWith(`${model}:`))
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
