import { describe, it, expect } from 'vitest'
import { OllamaProvider, extractJson } from '@core/llm'

type Call = { url: string; init?: RequestInit }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return handler(url, init)
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('OllamaProvider.generateJson', () => {
  it('generateJson envía format json y stream false', async () => {
    const { impl, calls } = fakeFetch(() =>
      jsonResponse({ message: { role: 'assistant', content: '{"preguntas":[1,2]}' } })
    )
    const p = new OllamaProvider({ fetchImpl: impl })
    const out = await p.generateJson({ system: 'SYS', user: 'USR' })

    expect(out).toEqual({ preguntas: [1, 2] })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://localhost:11434/api/chat')
    expect(calls[0].init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.model).toBe('qwen2.5:7b')
    expect(body.stream).toBe(false)
    expect(body.format).toBe('json')
    expect(body.options).toEqual({ temperature: 0.2 })
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' }
    ])
  })

  it('usa baseUrl y model personalizados', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ message: { content: '[]' } }))
    const p = new OllamaProvider({ baseUrl: 'http://host:1234', model: 'llama3', fetchImpl: impl })
    await p.generateJson({ system: 's', user: 'u' })
    expect(calls[0].url).toBe('http://host:1234/api/chat')
    expect(JSON.parse(String(calls[0].init?.body)).model).toBe('llama3')
  })

  it('lanza error legible en español si el servidor responde no-2xx', async () => {
    const { impl } = fakeFetch(() => new Response('boom', { status: 500 }))
    const p = new OllamaProvider({ fetchImpl: impl })
    await expect(p.generateJson({ system: 's', user: 'u' })).rejects.toThrow(/Ollama.*500/)
  })

  it('lanza error legible en español si falla la red', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const p = new OllamaProvider({ fetchImpl: impl })
    await expect(p.generateJson({ system: 's', user: 'u' })).rejects.toThrow(/No se pudo conectar con Ollama/)
  })

  it('lanza si la respuesta del modelo no contiene JSON', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ message: { content: 'lo siento, no puedo' } }))
    const p = new OllamaProvider({ fetchImpl: impl })
    await expect(p.generateJson({ system: 's', user: 'u' })).rejects.toThrow()
  })
})

describe('extractJson', () => {
  it('extractJson tolera texto antes/después y bloques ```json', () => {
    expect(extractJson('Claro, aquí tienes: {"a":1} Espero que sirva.')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":[1,2,{"b":3}]}\n```')).toEqual({ a: [1, 2, { b: 3 }] })
    expect(extractJson('Resultado:\n```json\n[1,2,3]\n```\nfin')).toEqual([1, 2, 3])
    expect(extractJson('  {"x":"y"}  ')).toEqual({ x: 'y' })
  })

  it('ignora llaves dentro de strings', () => {
    expect(extractJson('texto {"t":"un } y un { raro \\" comilla","n":1} cola }')).toEqual({
      t: 'un } y un { raro " comilla',
      n: 1
    })
  })

  it('toma el primer objeto balanceado', () => {
    expect(extractJson('{"a":1} y luego {"b":2}')).toEqual({ a: 1 })
  })

  it('salta candidatos inválidos y usa el siguiente JSON válido', () => {
    expect(extractJson('mira {esto no es json} pero {"ok":true}')).toEqual({ ok: true })
  })

  it('extractJson lanza con basura', () => {
    expect(() => extractJson('')).toThrow()
    expect(() => extractJson('no hay nada aquí')).toThrow()
    expect(() => extractJson('{"a": 1')).toThrow()
    expect(() => extractJson('{esto no es json}')).toThrow()
  })
})

describe('OllamaProvider.health', () => {
  it('health: Ollama apagado → ok false y mensaje que dice cómo arrancarlo', async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError('fetch failed')
    })
    const r = await new OllamaProvider({ fetchImpl: impl }).health()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('ollama serve')
    expect(r.message).toContain('https://ollama.com')
  })

  it('health: servidor que no responde no se cuelga (timeout)', async () => {
    const { impl } = fakeFetch(
      (_u, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const r = await new OllamaProvider({ fetchImpl: impl, timeoutMs: 20 }).health()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('ollama serve')
  })

  it('health: modelo ausente → ok false y mensaje con ollama pull <modelo>', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ models: [{ name: 'llama3:8b' }] }))
    const r = await new OllamaProvider({ fetchImpl: impl }).health()
    expect(calls[0].url).toBe('http://localhost:11434/api/tags')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('ollama pull qwen2.5:7b')
  })

  it('health: modelo presente → ok true', async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:7b' }] })
    )
    const r = await new OllamaProvider({ fetchImpl: impl }).health()
    expect(r.ok).toBe(true)
    expect(r.message.length).toBeGreaterThan(0)
  })

  it('health: modelo sin etiqueta coincide con cualquier etiqueta', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ models: [{ name: 'llama3:8b' }] }))
    const r = await new OllamaProvider({ model: 'llama3', fetchImpl: impl }).health()
    expect(r.ok).toBe(true)
  })

  it('health: modelo con etiqueta no coincide con otra etiqueta', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ models: [{ name: 'qwen2.5:3b' }] }))
    const r = await new OllamaProvider({ fetchImpl: impl }).health()
    expect(r.ok).toBe(false)
  })

  it('health: respuesta no-2xx → ok false', async () => {
    const { impl } = fakeFetch(() => new Response('x', { status: 503 }))
    const r = await new OllamaProvider({ fetchImpl: impl }).health()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('503')
  })
})
