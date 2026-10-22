import { describe, it, expect } from 'vitest'
import { openStore } from '@core/store'
import type { LlmProvider } from '@core/llm'
import { generateQuestions } from '@core/generate'

type Call = { system: string; user: string; n: number }
type Scripted = unknown | Error | ((call: Call) => unknown)

/** LLM falso: devuelve respuestas guionizadas en orden (repite la última) y cuenta llamadas. */
class FakeLlm implements LlmProvider {
  calls = 0
  prompts: Array<{ system: string; user: string }> = []
  constructor(private script: Scripted[]) {}
  async generateJson(p: { system: string; user: string; signal?: AbortSignal }): Promise<unknown> {
    this.prompts.push({ system: p.system, user: p.user })
    const item = this.script[Math.min(this.calls, this.script.length - 1)]
    this.calls++
    if (item instanceof Error) throw item
    if (typeof item === 'function') return (item as (c: Call) => unknown)({ system: p.system, user: p.user, n: this.calls })
    return item
  }
  async health() {
    return { ok: true, message: 'ok' }
  }
}

const T1 = 'La mitocondria es el orgánulo encargado de producir energía en forma de ATP.'
const T2 = 'El núcleo celular contiene el material genético de la célula.'
const Q2 = 'El núcleo celular contiene el material genético'

async function setup() {
  const store = await openStore()
  const s = store.createSubject('Biología')
  const doc = store.addDocument({ subjectId: s.id, title: 'tema 1', sourceType: 'text' })
  const [c1, c2] = store.addChunks(doc.id, s.id, [T1, T2])
  return { store, s, doc, c1, c2 }
}

const good = (chunkId: number, extra: Record<string, unknown> = {}) => ({
  enunciado: '¿Qué orgánulo produce energía?',
  respuesta: 'La mitocondria',
  explicacion: 'Lo dice el texto.',
  chunkId,
  cita: 'La mitocondria es el orgánulo encargado de producir energía',
  ...extra
})

describe('generateQuestions', () => {
  it('devuelve preguntas con cita válida y las guarda', async () => {
    const { store, s, c1 } = await setup()
    const llm = new FakeLlm([good(c1.id)])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(r.questions).toHaveLength(1)
    expect(r.discarded).toBe(0)
    expect(r.insufficient).toBe(false)
    const q = r.questions[0]
    expect(q.id).toBeTypeOf('number')
    expect(q).toMatchObject({
      subjectId: s.id,
      chunkId: c1.id,
      type: 'desarrollo',
      prompt: '¿Qué orgánulo produce energía?',
      answer: 'La mitocondria',
      explanation: 'Lo dice el texto.'
    })
    expect(q.quote).toBe('La mitocondria es el orgánulo encargado de producir energía')
    expect(store.listQuestions(s.id)).toHaveLength(1)
  })

  it('el prompt impone usar solo el texto, cita literal, sin_material y solo JSON; envía un único fragmento', async () => {
    const { store, s, c1 } = await setup()
    const llm = new FakeLlm([good(c1.id)])
    await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    const { system, user } = llm.prompts[0]
    expect(system).toContain('solo el texto')
    expect(system).toContain('literal')
    expect(system).toContain('{"sin_material":true}')
    expect(system.toLowerCase()).toContain('json')
    expect(user).toContain(String(c1.id))
    expect(user).toContain(T1)
    expect(user).not.toContain(T2)
  })

  it('descarta cita inventada tras 2 reintentos y cuenta discarded=1', async () => {
    const { store, s, c1 } = await setup()
    const llm = new FakeLlm([good(c1.id, { cita: 'El ribosoma sintetiza proteínas en el citoplasma.' })])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(llm.calls).toBe(3) // 1 intento + 2 reintentos
    expect(r.questions).toHaveLength(0)
    expect(r.discarded).toBe(1)
    expect(r.reasons).toHaveLength(1)
    expect(r.reasons[0]).toMatch(/cita/i)
    expect(r.insufficient).toBe(true)
    expect(store.listQuestions(s.id)).toHaveLength(0)
  })

  it('acepta una respuesta válida en el reintento', async () => {
    const { store, s, c1 } = await setup()
    const llm = new FakeLlm([good(c1.id, { cita: 'cita inventada que no aparece' }), good(c1.id)])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(llm.calls).toBe(2)
    expect(r.questions).toHaveLength(1)
    expect(r.discarded).toBe(0)
  })

  it('descarta chunkId de otra asignatura o no enviado', async () => {
    const { store, s, c2 } = await setup()
    const other = store.createSubject('Historia')
    const od = store.addDocument({ subjectId: other.id, title: 'h', sourceType: 'text' })
    const [oc] = store.addChunks(od.id, other.id, ['La Revolución Francesa comenzó en 1789 en París.'])
    // chunkId de otra asignatura (con cita literal de ese chunk ajeno)
    const llmA = new FakeLlm([good(oc.id, { cita: 'La Revolución Francesa comenzó en 1789' })])
    const a = await generateQuestions({ llm: llmA, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(a.questions).toHaveLength(0)
    expect(a.discarded).toBe(1)
    // chunkId de la misma asignatura pero no enviado en ese prompt (se envió c1, responde c2 con cita válida de c2)
    const llmB = new FakeLlm([good(c2.id, { cita: Q2 })])
    const b = await generateQuestions({ llm: llmB, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(b.questions).toHaveLength(0)
    expect(b.discarded).toBe(1)
    expect(store.listQuestions(s.id)).toHaveLength(0)
    expect(store.listQuestions(other.id)).toHaveLength(0)
  })

  it('verifica la cita contra el texto del chunk del store, no contra texto del modelo', async () => {
    const { store, s, c1 } = await setup()
    const resp = { ...good(c1.id, { cita: 'El ribosoma sintetiza proteínas' }), texto: 'El ribosoma sintetiza proteínas' }
    const r = await generateQuestions({ llm: new FakeLlm([resp]), store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
    expect(r.questions).toHaveLength(0)
  })

  it('asignatura sin chunks → insufficient true y FakeLlm no es llamado', async () => {
    const store = await openStore()
    const s = store.createSubject('Vacía')
    const llm = new FakeLlm([{}])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'test', count: 3 })
    expect(llm.calls).toBe(0)
    expect(r).toEqual({ questions: [], discarded: 0, reasons: ['sin material suficiente'], insufficient: true })
  })

  it('no usa chunks de otra asignatura', async () => {
    const { store } = await setup()
    const other = store.createSubject('Otra')
    const llm = new FakeLlm([{}])
    const r = await generateQuestions({ llm, store }, { subjectId: other.id, type: 'vf', count: 1 })
    expect(llm.calls).toBe(0)
    expect(r.insufficient).toBe(true)
  })

  it('topic ausente en apuntes → insufficient true sin llamar al LLM', async () => {
    const { store, s } = await setup()
    const llm = new FakeLlm([{}])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'vf', count: 2, topic: 'Revolución Francesa' })
    expect(llm.calls).toBe(0)
    expect(r.insufficient).toBe(true)
    expect(r.questions).toEqual([])
    expect(r.reasons).toEqual(['sin material suficiente'])
  })

  it('topic presente (sin tildes ni mayúsculas) filtra los chunks enviados', async () => {
    const { store, s, c2 } = await setup()
    const llm = new FakeLlm([good(c2.id, { cita: Q2 })])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1, topic: 'NUCLEO' })
    expect(r.questions).toHaveLength(1)
    expect(llm.prompts[0].user).toContain(T2)
    expect(llm.prompts[0].user).not.toContain(T1)
  })

  it('documentId filtra los chunks', async () => {
    const { store, s } = await setup()
    const d2 = store.addDocument({ subjectId: s.id, title: 'tema 2', sourceType: 'text' })
    const [c3] = store.addChunks(d2.id, s.id, ['El aparato de Golgi empaqueta las proteínas para su envío.'])
    const llm = new FakeLlm([good(c3.id, { cita: 'El aparato de Golgi empaqueta las proteínas' })])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1, documentId: d2.id })
    expect(r.questions).toHaveLength(1)
    expect(llm.prompts[0].user).not.toContain(T1)
  })

  it('reparte las preguntas entre los chunks disponibles', async () => {
    const { store, s, c1, c2 } = await setup()
    const llm = new FakeLlm([
      ({ user }: Call) => (user.includes(T1) ? good(c1.id) : good(c2.id, { cita: Q2 }))
    ])
    const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 2 })
    expect(r.questions.map((q) => q.chunkId)).toEqual([c1.id, c2.id])
  })

  describe('validación de forma (nunca lanza)', () => {
    const bad: Array<[string, unknown]> = [
      ['null', null],
      ['string', 'hola'],
      ['número', 42],
      ['array', [1, 2]],
      ['objeto vacío', {}],
      ['sin enunciado', { respuesta: 'a', explicacion: 'b', chunkId: 1, cita: 'x' }],
      ['enunciado vacío', { enunciado: '  ', respuesta: 'a', explicacion: 'b', chunkId: 1, cita: 'x' }],
      ['chunkId no entero', { enunciado: 'e', respuesta: 'a', explicacion: 'b', chunkId: '1', cita: 'x' }],
      ['chunkId decimal', { enunciado: 'e', respuesta: 'a', explicacion: 'b', chunkId: 1.5, cita: 'x' }],
      ['cita no string', { enunciado: 'e', respuesta: 'a', explicacion: 'b', chunkId: 1, cita: 7 }],
      ['explicacion ausente', { enunciado: 'e', respuesta: 'a', chunkId: 1, cita: 'x' }]
    ]
    for (const [name, resp] of bad) {
      it(`${name} → descartada sin lanzar`, async () => {
        const { store, s } = await setup()
        const llm = new FakeLlm([resp])
        const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
        expect(r.questions).toHaveLength(0)
        expect(r.discarded).toBe(1)
        expect(r.reasons).toHaveLength(1)
        expect(llm.calls).toBe(3)
      })
    }

    it('error del LLM cuenta como intento fallido con motivo, sin lanzar', async () => {
      const { store, s, c1 } = await setup()
      const llm = new FakeLlm([new Error('boom'), good(c1.id)])
      const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
      expect(r.questions).toHaveLength(1)
      const llm2 = new FakeLlm([new Error('boom')])
      const r2 = await generateQuestions({ llm: llm2, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
      expect(llm2.calls).toBe(3)
      expect(r2.discarded).toBe(1)
      expect(r2.reasons[0]).toContain('boom')
    })

    it('{"sin_material":true} es descarte con razón "sin material"', async () => {
      const { store, s } = await setup()
      const llm = new FakeLlm([{ sin_material: true }])
      const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 1 })
      expect(r.questions).toHaveLength(0)
      expect(r.discarded).toBe(1)
      expect(r.reasons[0]).toMatch(/sin material/i)
    })
  })

  describe('tipos', () => {
    it('test exige 4 opciones y la respuesta es una de ellas', async () => {
      const { store, s, c1 } = await setup()
      const opciones = ['La mitocondria', 'El ribosoma', 'El núcleo', 'El lisosoma']
      const ok = await generateQuestions(
        { llm: new FakeLlm([good(c1.id, { opciones })]), store },
        { subjectId: s.id, type: 'test', count: 1 }
      )
      expect(ok.questions).toHaveLength(1)
      expect(ok.questions[0].options).toEqual(opciones)
      expect(ok.questions[0].answer).toBe('La mitocondria')

      const casos: Array<Record<string, unknown>> = [
        { opciones: opciones.slice(0, 3) }, // 3
        { opciones: [...opciones, 'El Golgi'] }, // 5
        { opciones: undefined }, // sin opciones
        { opciones: ['a', 'a', 'b', 'c'], respuesta: 'a' }, // repetidas
        { opciones: ['La mitocondria', '', 'El núcleo', 'El lisosoma'] }, // vacía
        { opciones: ['La mitocondria', 2, 'El núcleo', 'El lisosoma'] }, // no string
        { respuesta: 'El peroxisoma', opciones }, // respuesta fuera de opciones
        { opciones: 'a,b,c,d' }
      ]
      for (const extra of casos) {
        const llm = new FakeLlm([good(c1.id, extra)])
        const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'test', count: 1 })
        expect(r.questions, JSON.stringify(extra)).toHaveLength(0)
        expect(r.discarded).toBe(1)
      }
    })

    it('vf: respuesta es verdadero|falso (canónico en minúsculas)', async () => {
      const { store, s, c1 } = await setup()
      for (const [inp, out] of [
        ['verdadero', 'verdadero'],
        ['Falso', 'falso'],
        [' VERDADERO ', 'verdadero']
      ]) {
        const r = await generateQuestions(
          { llm: new FakeLlm([good(c1.id, { respuesta: inp })]), store },
          { subjectId: s.id, type: 'vf', count: 1 }
        )
        expect(r.questions[0].answer).toBe(out)
        expect(r.questions[0].options).toBeUndefined()
      }
      for (const inp of ['sí', 'true', 'La mitocondria', '']) {
        const r = await generateQuestions(
          { llm: new FakeLlm([good(c1.id, { respuesta: inp })]), store },
          { subjectId: s.id, type: 'vf', count: 1 }
        )
        expect(r.questions, inp).toHaveLength(0)
        expect(r.discarded).toBe(1)
      }
    })

    it('desarrollo exige respuesta no vacía', async () => {
      const { store, s, c1 } = await setup()
      const r = await generateQuestions(
        { llm: new FakeLlm([good(c1.id, { respuesta: '   ' })]), store },
        { subjectId: s.id, type: 'desarrollo', count: 1 }
      )
      expect(r.questions).toHaveLength(0)
    })
  })

  describe('progreso y cancelación', () => {
    it('onProgress se llama una vez por pregunta (válida o no)', async () => {
      const { store, s, c1 } = await setup()
      // pregunta 1 válida; pregunta 2 agota sus 3 intentos con sin_material; pregunta 3 válida
      const llm = new FakeLlm([
        good(c1.id),
        { sin_material: true },
        { sin_material: true },
        { sin_material: true },
        ({ user }: Call) => (user.includes(T1) ? good(c1.id) : good(c1.id + 1, { cita: Q2 }))
      ])
      const calls: Array<[number, number]> = []
      const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 3 }, (d, t) =>
        calls.push([d, t])
      )
      expect(calls).toEqual([
        [1, 3],
        [2, 3],
        [3, 3]
      ])
      expect(r.questions).toHaveLength(2)
      expect(r.discarded).toBe(1)
    })

    it('un AbortSignal ya cancelado no llama al LLM ni lanza', async () => {
      const { store, s } = await setup()
      const llm = new FakeLlm([{}])
      const ac = new AbortController()
      ac.abort()
      const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 3 }, undefined, ac.signal)
      expect(llm.calls).toBe(0)
      expect(r).toMatchObject({ questions: [], discarded: 0, insufficient: false })
    })

    it('AbortSignal cancela a mitad y devuelve lo generado hasta entonces', async () => {
      const { store, s, c1, c2 } = await setup()
      const ac = new AbortController()
      const llm = new FakeLlm([
        good(c1.id),
        () => {
          ac.abort()
          return good(c2.id, { cita: Q2 })
        },
        good(c1.id)
      ])
      const progress: number[] = []
      const r = await generateQuestions(
        { llm, store },
        { subjectId: s.id, type: 'desarrollo', count: 5 },
        (d) => progress.push(d),
        ac.signal
      )
      expect(llm.calls).toBe(2)
      expect(r.questions).toHaveLength(1)
      expect(r.insufficient).toBe(false)
      expect(store.listQuestions(s.id)).toHaveLength(1)
      expect(progress).toEqual([1])
    })

    it('un error del LLM tras abortar no lanza ni reintenta', async () => {
      const { store, s } = await setup()
      const ac = new AbortController()
      const llm = new FakeLlm([
        () => {
          ac.abort()
          throw new Error('Se ha cancelado la generación con Ollama.')
        }
      ])
      const r = await generateQuestions({ llm, store }, { subjectId: s.id, type: 'desarrollo', count: 2 }, undefined, ac.signal)
      expect(llm.calls).toBe(1)
      expect(r.questions).toEqual([])
      expect(r.insufficient).toBe(false)
    })
  })
})
