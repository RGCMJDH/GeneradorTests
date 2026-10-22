import { describe, it, expect } from 'vitest'
import { openStore } from '@core/store'
import type { LlmProvider } from '@core/llm'
import { extractConcepts } from '@core/graph'

type Scripted = unknown | Error | ((user: string, n: number) => unknown)

class FakeLlm implements LlmProvider {
  calls = 0
  constructor(private script: Scripted[]) {}
  async generateJson(p: { system: string; user: string; signal?: AbortSignal }): Promise<unknown> {
    const item = this.script[Math.min(this.calls, this.script.length - 1)]
    this.calls++
    if (item instanceof Error) throw item
    if (typeof item === 'function') return (item as (u: string, n: number) => unknown)(p.user, this.calls)
    return item
  }
  async health() {
    return { ok: true, message: 'ok' }
  }
}

const T1 = 'La mitocondria produce ATP. El núcleo celular contiene el ADN.'
const T2 = 'El ADN se replica en el núcleo celular antes de la división.'
const T3 = 'Los ribosomas sintetizan proteínas.'

async function setup(texts: string[] = [T1, T2, T3]) {
  const store = await openStore()
  const s = store.createSubject('Biología')
  const doc = store.addDocument({ subjectId: s.id, title: 'tema 1', sourceType: 'text' })
  const chunks = store.addChunks(doc.id, s.id, texts)
  return { store, s, doc, chunks }
}

describe('extractConcepts: fallos del modelo', () => {
  it('informa de los chunks fallidos (excepción o forma inválida) y no de los vacíos', async () => {
    const { store, s, chunks } = await setup([T1, T2, T3])
    const failed: Array<[number, string]> = []
    const llm = new FakeLlm([
      (user: string) => {
        if (user.includes(T1)) throw new Error('Ollama caído')
        if (user.includes(T2)) return { conceptos: 'no es lista' }
        return { conceptos: [] } // T3: sin conceptos, NO es un fallo
      }
    ])
    const out = await extractConcepts({ llm, store }, s.id, { onChunkError: (id, reason) => failed.push([id, reason]) })
    expect(out).toEqual([])
    expect(failed.map(([id]) => id)).toEqual([chunks[0].id, chunks[1].id])
    expect(failed[0][1]).toMatch(/Ollama caído/)
    expect(failed[1][1]).toMatch(/forma/i)
  })

  it('una cancelación en vuelo no cuenta como fallo', async () => {
    const { store, s } = await setup()
    const ac = new AbortController()
    const failed: number[] = []
    const llm = new FakeLlm([
      () => {
        ac.abort()
        throw new Error('abortado')
      }
    ])
    await extractConcepts({ llm, store }, s.id, { signal: ac.signal, onChunkError: (id) => failed.push(id) })
    expect(failed).toEqual([])
  })

  it('un onChunkError que lanza no rompe la extracción', async () => {
    const { store, s } = await setup([T1])
    const llm = new FakeLlm([new Error('x')])
    await expect(
      extractConcepts({ llm, store }, s.id, {
        onChunkError: () => {
          throw new Error('cb')
        }
      })
    ).resolves.toEqual([])
  })

  it('onProgress recibe también el id del chunk procesado', async () => {
    const { store, s, chunks } = await setup([T1, T2])
    const ids: Array<number | undefined> = []
    const llm = new FakeLlm([{ conceptos: [] }])
    await extractConcepts({ llm, store }, s.id, { onProgress: (_d, _t, id) => ids.push(id) })
    expect(ids).toEqual(chunks.map((c) => c.id))
  })
})

describe('extractConcepts: presupuesto de 60 chunks repartido entre documentos', () => {
  async function twoDocs(a: number, b: number) {
    const store = await openStore()
    const s = store.createSubject('S')
    const d1 = store.addDocument({ subjectId: s.id, title: 'uno', sourceType: 'text' })
    const d2 = store.addDocument({ subjectId: s.id, title: 'dos', sourceType: 'text' })
    const c1 = store.addChunks(d1.id, s.id, Array.from({ length: a }, (_, i) => `uno pieza ${i}`))
    const c2 = store.addChunks(d2.id, s.id, Array.from({ length: b }, (_, i) => `dos pieza ${i}`))
    return { store, s, d1, d2, c1, c2 }
  }
  const seenIds = async (store: Awaited<ReturnType<typeof openStore>>, sid: number, opts = {}) => {
    const ids: number[] = []
    await extractConcepts({ llm: new FakeLlm([{ conceptos: [] }]), store }, sid, { ...opts, onProgress: (_d, _t, id) => void ids.push(id as number) })
    return ids
  }

  it('50 + 50 chunks: 30 de cada documento, no los 60 primeros del primero', async () => {
    const { store, s, c1, c2 } = await twoDocs(50, 50)
    const ids = await seenIds(store, s.id)
    expect(ids).toHaveLength(60)
    expect(ids.filter((i) => c1.some((c) => c.id === i))).toHaveLength(30)
    expect(ids.filter((i) => c2.some((c) => c.id === i))).toHaveLength(30)
    // determinista: los primeros 30 de cada documento, en orden de documento y posición
    expect(ids).toEqual([...c1.slice(0, 30), ...c2.slice(0, 30)].map((c) => c.id))
  })

  it('5 + 100 chunks: el documento pequeño entra entero y el resto del presupuesto va al grande', async () => {
    const { store, s, c1, c2 } = await twoDocs(5, 100)
    const ids = await seenIds(store, s.id)
    expect(ids).toHaveLength(60)
    expect(ids.filter((i) => c1.some((c) => c.id === i))).toHaveLength(5)
    expect(ids.filter((i) => c2.some((c) => c.id === i))).toHaveLength(55)
  })

  it('hasta 60 chunks se analizan todos, y con documentId solo ese documento (sus primeros 60)', async () => {
    const small = await twoDocs(20, 30)
    expect(await seenIds(small.store, small.s.id)).toHaveLength(50)
    const big = await twoDocs(3, 80)
    const only = await seenIds(big.store, big.s.id, { documentId: big.d2.id })
    expect(only).toEqual(big.c2.slice(0, 60).map((c) => c.id))
  })
})

describe('extractConcepts: términos sin contenido', () => {
  it('descarta términos sin letras y los formados solo por palabras funcionales', async () => {
    const text = 'En 2024 se midieron 123 casos. De la célula, el núcleo y más. Es la membrana.'
    const { store, s } = await setup([text])
    const llm = new FakeLlm([{ conceptos: ['2024', '123', 'de la', 'el', 'del', 'más', 'es la', 'se', 'núcleo', 'la membrana', 'célula'] }])
    const out = await extractConcepts({ llm, store }, s.id)
    expect(out.map((c) => c.term).sort()).toEqual(['célula', 'la membrana', 'núcleo'].sort())
  })

  it('un término con símbolos y números pero con alguna palabra de contenido se conserva', async () => {
    const { store, s } = await setup(['El ADN-3 y la vitamina B12 son temas.'])
    const llm = new FakeLlm([{ conceptos: ['vitamina B12', 'ADN-3'] }])
    expect((await extractConcepts({ llm, store }, s.id)).map((c) => c.term).sort()).toEqual(['ADN-3', 'vitamina B12'])
  })
})
