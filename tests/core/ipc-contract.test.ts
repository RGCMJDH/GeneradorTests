import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore, type Store } from '@core/store'
import { NoTextError } from '@core/ingest'
import type { LlmProvider } from '@core/llm'
import { channels, events, type Failure, type Result } from '../../src/shared/api'
import * as mainChannels from '../../src/main/channels'
import { registerIpc } from '../../src/main/ipc'
import { realCore, type CoreFns, type IpcContext, type Registrar } from '../../src/main/ipc/context'
import { ingestImageFromPath } from '../../src/main/ipc/notes'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const text = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

// ---------------------------------------------------------------- utilidades

type Handler = (event: unknown, ...args: unknown[]) => unknown

function fakeRegistrar() {
  const handlers = new Map<string, Handler>()
  const registrar: Registrar = {
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error(`canal duplicado: ${channel}`)
      handlers.set(channel, listener as Handler)
    }
  }
  return { handlers, registrar }
}

const llm = (over: Partial<LlmProvider> = {}): LlmProvider => ({
  generateJson: async () => ({}),
  health: async () => ({ ok: true, message: 'ok' }),
  ...over
})

interface Setup {
  ctx: IpcContext
  store: Store
  call: <T = unknown>(channel: string, ...args: unknown[]) => Promise<Result<T>>
  sent: Array<{ channel: string; payload: unknown }>
  dialog: { calls: Array<{ filters?: Array<{ extensions: string[] }>; properties?: string[] }>; next: { canceled: boolean; filePaths: string[] } }
}

async function setup(over: { ctx?: Partial<IpcContext>; core?: Partial<CoreFns>; store?: Store } = {}): Promise<Setup> {
  const store = over.store ?? (await openStore())
  const dialog: Setup['dialog'] = { calls: [], next: { canceled: true, filePaths: [] } }
  const ctx: IpcContext = {
    store,
    llm: llm(),
    dialog: {
      showOpenDialog: async (opts) => {
        dialog.calls.push(opts)
        return dialog.next
      }
    },
    userDataDir: join(ROOT, 'userData-fake'),
    model: 'qwen2.5:7b',
    core: { ...realCore, ...over.core },
    ...over.ctx
  }
  const { handlers, registrar } = fakeRegistrar()
  registerIpc(ctx, registrar)
  const sent: Setup['sent'] = []
  const event = { sender: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }), isDestroyed: () => false } }
  const call = async <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => {
    const h = handlers.get(channel)
    if (!h) throw new Error(`sin handler: ${channel}`)
    return (await h(event, ...args)) as Result<T>
  }
  return { ctx, store, call, sent, dialog }
}

/** Store cuyo uso (cualquier método) hace fallar la prueba: demuestra que el core no se tocó. */
function untouchableStore(): { store: Store; touched: string[] } {
  const touched: string[] = []
  const store = new Proxy({}, { get: (_t, prop) => () => { touched.push(String(prop)); throw new Error('store tocado') } }) as Store
  return { store, touched }
}

const boom = (name: string) => () => { throw new Error(`core tocado: ${name}`) }
const explodingCore: CoreFns = {
  importTextFile: boom('importTextFile') as CoreFns['importTextFile'],
  importPdf: boom('importPdf') as CoreFns['importPdf'],
  importImage: boom('importImage') as CoreFns['importImage'],
  confirmOcr: boom('confirmOcr') as CoreFns['confirmOcr'],
  generateQuestions: boom('generateQuestions') as CoreFns['generateQuestions'],
  gradeAnswer: boom('gradeAnswer') as CoreFns['gradeAnswer'],
  extractConcepts: boom('extractConcepts') as CoreFns['extractConcepts']
}

const fail = (r: Result<unknown>): Failure => {
  expect(r.ok).toBe(false)
  return r as Failure
}

// ------------------------------------------------------------------ (i) canales

describe('contrato de canales', () => {
  it('los nombres de canal son únicos y distintos de los eventos', () => {
    const names = [...Object.values(channels), ...Object.values(events)]
    expect(new Set(names).size).toBe(names.length)
  })

  it('src/main/channels.ts reexporta exactamente la misma fuente', () => {
    expect(mainChannels.channels).toBe(channels)
    expect(mainChannels.events).toBe(events)
  })

  it('registerIpc registra un handler por cada canal, y solo esos', async () => {
    const { handlers, registrar } = fakeRegistrar()
    registerIpc((await setup()).ctx, registrar)
    expect([...handlers.keys()].sort()).toEqual(Object.values(channels).sort())
  })
})

describe('preload', () => {
  const preload = text('src/preload/index.ts')

  it('solo usa nombres que existen en channels/events', () => {
    const used = [...preload.matchAll(/\bchannels\.(\w+)/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    for (const name of used) expect(Object.keys(channels), `channels.${name}`).toContain(name)
    for (const m of preload.matchAll(/\bevents\.(\w+)/g)) expect(Object.keys(events), `events.${m[1]}`).toContain(m[1])
  })

  it('cubre todos los canales (no queda ningún handler sin método en window.api)', () => {
    const used = new Set([...preload.matchAll(/\bchannels\.(\w+)/g)].map((m) => m[1]))
    expect([...used].sort()).toEqual(Object.keys(channels).sort())
  })

  it('no hardcodea literales de canal ni expone ipcRenderer', () => {
    for (const v of [...Object.values(channels), ...Object.values(events)]) expect(preload).not.toContain(`'${v}'`)
    expect(preload).not.toMatch(/exposeInMainWorld\('api',\s*ipcRenderer/)
  })

  it('las suscripciones del móvil devuelven la función para cancelarlas', () => {
    for (const ev of ['mobileImage', 'mobileStopped']) {
      expect(preload).toContain(`ipcRenderer.on(events.${ev}, listener)`)
      expect(preload).toContain(`ipcRenderer.removeListener(events.${ev}, listener)`)
    }
  })
})

// ---------------------------------------------------------- (iii) validación

describe('validación en la frontera IPC', () => {
  const longText = 'x'.repeat(2_000_001)
  const gen = (over: Record<string, unknown>) => ({ requestId: 'r1', subjectId: 1, type: 'vf', count: 3, ...over })
  const cases: Array<[string, string, unknown[]]> = [
    ['subjects:create', 'nombre vacío', ['']],
    ['subjects:create', 'nombre solo espacios', ['   ']],
    ['subjects:create', 'nombre de 101 caracteres', ['n'.repeat(101)]],
    ['subjects:create', 'nombre no string', [42]],
    ['subjects:create', 'argumentos de más', ['ok', '/etc/passwd']],
    ['notes:import', 'subjectId negativo', [-1, 'text']],
    ['notes:import', 'subjectId decimal', [1.5, 'text']],
    ['notes:import', 'subjectId NaN', [NaN, 'text']],
    ['notes:import', 'kind desconocido', [1, 'exe']],
    ['notes:import', 'ruta en lugar de kind', [1, 'C:\\secreto.txt']],
    ['notes:import', 'ruta como tercer argumento', [1, 'text', 'C:\\secreto.txt']],
    ['notes:importMany', 'subjectId negativo', [-1, 'text']],
    ['notes:importMany', 'kind desconocido', [1, 'exe']],
    ['notes:importMany', 'ruta como tercer argumento', [1, 'text', 'C:\\secreto.txt']],
    ['notes:confirmOcr', 'documentId 0', [0, 'texto']],
    ['notes:confirmOcr', 'texto de más de 2 MB', [1, longText]],
    ['notes:confirmOcr', 'texto no string', [1, null]],
    ['notes:confirmOcr', 'force no booleano', [1, 'ok', 'si']],
    ['notes:list', 'subjectId negativo', [-3]],
    ['notes:chunks', 'documentId inválido', [1, -2]],
    ['notes:chunk', 'chunkId Infinity', [1, Infinity]],
    ['notes:deleteDocument', 'documentId string', [1, '2']],
    ['quiz:generate', 'payload no objeto', ['hola']],
    ['quiz:generate', 'requestId vacío', [gen({ requestId: '' })]],
    ['quiz:generate', 'requestId con caracteres raros', [gen({ requestId: '../x' })]],
    ['quiz:generate', 'type desconocido', [gen({ type: 'oral' })]],
    ['quiz:generate', 'count 0', [gen({ count: 0 })]],
    ['quiz:generate', 'count decimal', [gen({ count: 2.5 })]],
    ['quiz:generate', 'topic enorme', [gen({ topic: 't'.repeat(201) })]],
    ['quiz:generate', 'clave extra tipo ruta', [gen({ path: 'C:\\x.pdf' })]],
    ['quiz:cancel', 'requestId no string', [7]],
    ['quiz:startAttempt', 'subjectId negativo', [-1]],
    ['quiz:finishAttempt', 'attemptId inválido', [1, 0]],
    ['quiz:submit', 'payload no objeto', [null]],
    ['quiz:submit', 'respuesta de más de 20000 caracteres', [{ subjectId: 1, attemptId: 1, questionId: 1, answer: 'a'.repeat(20001) }]],
    ['quiz:submit', 'answer no string', [{ subjectId: 1, attemptId: 1, questionId: 1, answer: 5 }]],
    ['quiz:submit', 'questionId negativo', [{ subjectId: 1, attemptId: 1, questionId: -1, answer: 'a' }]],
    ['quiz:submit', 'clave extra', [{ subjectId: 1, attemptId: 1, questionId: 1, answer: 'a', path: 'C:\\x' }]],
    ['history:list', 'subjectId string', ['1']],
    ['concepts:list', 'subjectId negativo', [-1]],
    ['concepts:list', 'argumentos de más', [1, 2]],
    ['concepts:build', 'payload no objeto', ['hola']],
    ['concepts:build', 'requestId vacío', [{ requestId: '', subjectId: 1 }]],
    ['concepts:build', 'requestId con caracteres raros', [{ requestId: '../x', subjectId: 1 }]],
    ['concepts:build', 'subjectId decimal', [{ requestId: 'r', subjectId: 1.5 }]],
    ['concepts:build', 'documentId inválido', [{ requestId: 'r', subjectId: 1, documentId: 0 }]],
    ['concepts:build', 'clave extra tipo ruta', [{ requestId: 'r', subjectId: 1, path: 'C:\\x' }]],
    ['concepts:build', 'argumentos de más', [{ requestId: 'r', subjectId: 1 }, 'x']],
    ['concepts:cancel', 'requestId no string', [7]],
    ['mobile:start', 'payload no objeto', ['hola']],
    ['mobile:start', 'sin argumentos', []],
    ['mobile:start', 'subjectId inválido', [{ subjectId: 0 }]],
    ['mobile:start', 'clave extra tipo host', [{ subjectId: 1, host: '0.0.0.0' }]],
    ['mobile:start', 'argumentos de más', [{ subjectId: 1 }, 'x']],
    ['mobile:stop', 'argumentos de más', ['x']],
    ['system:health', 'argumentos de más', ['x']]
  ]

  it.each(cases)('%s rechaza: %s sin tocar store ni core', async (channel, _why, args) => {
    const { store, touched } = untouchableStore()
    const s = await setup({ store, core: explodingCore })
    const r = fail(await s.call(channel, ...args))
    expect(r.code).toBe('INVALID')
    expect(r.error.length).toBeGreaterThan(0)
    expect(touched).toEqual([])
    expect(s.dialog.calls).toEqual([]) // ni siquiera se abrió el diálogo
  })

  it('un nombre válido se recorta y se guarda', async () => {
    const s = await setup()
    const r = await s.call<{ id: number; name: string }>('subjects:create', '  Biología  ')
    expect(r).toMatchObject({ ok: true, data: { name: 'Biología' } })
    expect((await s.call('subjects:list')).ok).toBe(true)
  })
})

// ------------------------------------------------------ importación de apuntes

describe('notes:import', () => {
  it('abre el diálogo en main con filtros por tipo y devuelve canceled si se cancela', async () => {
    const s = await setup({ core: explodingCore })
    const subj = s.store.createSubject('A')
    for (const [kind, ext] of [['text', 'md'], ['pdf', 'pdf'], ['image', 'png']] as const) {
      const r = await s.call('notes:import', subj.id, kind)
      expect(r).toEqual({ ok: true, data: { canceled: true } })
      const opts = s.dialog.calls.at(-1)!
      expect(opts.properties).toContain('openFile')
      expect(opts.properties).not.toContain('multiSelections')
      expect(opts.filters!.flatMap((f) => f.extensions)).toContain(ext)
    }
  })

  it('importa un texto elegido en el diálogo y devuelve el documento con su recuento de chunks', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: [join(ROOT, 'tests/fixtures/apuntes-ejemplo.md')] }
    const r = await s.call<{ canceled: false; kind: string; document: { id: number; chunkCount: number; title: string } }>('notes:import', subj.id, 'text')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.document.chunkCount).toBeGreaterThan(0)
    expect(r.data.document.chunkCount).toBe(s.store.listChunks(subj.id).length)
    expect(JSON.stringify(r)).not.toContain('apuntes-ejemplo.md') // el DTO no filtra la ruta
  })

  it('un PDF sin texto devuelve el código NO_TEXT', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: [join(ROOT, 'tests/fixtures/sin-texto.pdf')] }
    const r = fail(await s.call('notes:import', subj.id, 'pdf'))
    expect(r.code).toBe('NO_TEXT')
    expect(s.store.listDocuments(subj.id)).toEqual([])
  })

  it('NoTextError del core se traduce a NO_TEXT', async () => {
    const s = await setup({ core: { importPdf: async () => { throw new NoTextError() } } })
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: ['x.pdf'] }
    expect(fail(await s.call('notes:import', subj.id, 'pdf')).code).toBe('NO_TEXT')
  })

  it('image: devuelve {documentId, ocrText} y pasa cachePath/timeoutMs de OCR', async () => {
    const importImage = vi.fn(async (deps: { store: Store }, subjectId: number, path: string, _opts?: unknown) => ({
      document: deps.store.addDocument({ subjectId, title: 'foto', sourceType: 'image', path }),
      ocrText: 'texto reconocido'
    }))
    const s = await setup({ core: { importImage: importImage as unknown as CoreFns['importImage'] } })
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: ['C:\\fotos\\a.png'] }
    const r = await s.call<{ kind: string; documentId: number; ocrText: string }>('notes:import', subj.id, 'image')
    expect(r).toMatchObject({ ok: true, data: { canceled: false, kind: 'image', ocrText: 'texto reconocido' } })
    const opts = importImage.mock.calls[0][3] as { cachePath: string; timeoutMs: number }
    expect(opts.cachePath).toBe(join(s.ctx.userDataDir, 'tessdata'))
    expect(opts.timeoutMs).toBe(300000)
  })

  it('ingestImageFromPath es reutilizable (sin diálogo) y valida la asignatura', async () => {
    const importImage = vi.fn(async (deps: { store: Store }, subjectId: number, path: string) => ({
      document: deps.store.addDocument({ subjectId, title: 'm', sourceType: 'image', path }),
      ocrText: 'ocr'
    }))
    const s = await setup({ core: { importImage: importImage as unknown as CoreFns['importImage'] } })
    const subj = s.store.createSubject('A')
    await expect(ingestImageFromPath(s.ctx, subj.id, 'C:\\tmp\\up.jpg')).resolves.toMatchObject({ ocrText: 'ocr' })
    await expect(ingestImageFromPath(s.ctx, 999, 'C:\\tmp\\up.jpg')).rejects.toThrow()
    expect(importImage).toHaveBeenCalledTimes(1)
  })

  it('asignatura inexistente: NOT_FOUND antes de abrir el diálogo', async () => {
    const s = await setup({ core: explodingCore })
    expect(fail(await s.call('notes:import', 999, 'text')).code).toBe('NOT_FOUND')
    expect(s.dialog.calls).toEqual([])
  })
})

describe('notes:importMany', () => {
  type Item = { file: string; ok: boolean; kind?: string; document?: { id: number; chunkCount: number }; documentId?: number; ocrText?: string; error?: string; code?: string }
  type Many = { canceled: false; items: Item[] }

  it('abre el diálogo con selección múltiple y devuelve canceled si se cancela', async () => {
    const s = await setup({ core: explodingCore })
    const subj = s.store.createSubject('A')
    for (const [kind, ext] of [['text', 'md'], ['pdf', 'pdf'], ['image', 'png']] as const) {
      expect(await s.call('notes:importMany', subj.id, kind)).toEqual({ ok: true, data: { canceled: true } })
      const opts = s.dialog.calls.at(-1)!
      expect(opts.properties).toEqual(['openFile', 'multiSelections'])
      expect(opts.filters!.flatMap((f) => f.extensions)).toContain(ext)
    }
  })

  it('importa todos los archivos elegidos, en orden, con un resultado por archivo y solo el nombre (no la ruta)', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    const md = join(ROOT, 'tests/fixtures/apuntes-ejemplo.md')
    s.dialog.next = { canceled: false, filePaths: [md, md] }
    const r = await s.call<Many>('notes:importMany', subj.id, 'text')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(2)
    for (const it of r.data.items) {
      expect(it).toMatchObject({ file: 'apuntes-ejemplo.md', ok: true, kind: 'text' })
      expect(it.document!.chunkCount).toBeGreaterThan(0)
    }
    expect(s.store.listDocuments(subj.id)).toHaveLength(2)
    expect(JSON.stringify(r)).not.toContain('tests/fixtures')
  })

  it('un archivo que falla no detiene los demás: su resultado lleva el error y el código', async () => {
    const importPdf = vi.fn(async (deps: { store: Store }, subjectId: number, path: string) => {
      if (path.endsWith('escaneo.pdf')) throw new NoTextError()
      if (path.endsWith('roto.pdf')) throw new Error('PDF dañado')
      return { document: deps.store.addDocument({ subjectId, title: path, sourceType: 'pdf', path }), chunks: [] }
    })
    const s = await setup({ core: { importPdf: importPdf as unknown as CoreFns['importPdf'] } })
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: ['C:\\apuntes\\a.pdf', 'C:\\apuntes\\escaneo.pdf', '/home/x/roto.pdf', 'C:\\apuntes\\b.pdf'] }
    const r = await s.call<Many>('notes:importMany', subj.id, 'pdf')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.map((i) => [i.file, i.ok, i.code])).toEqual([
      ['a.pdf', true, undefined],
      ['escaneo.pdf', false, 'NO_TEXT'],
      ['roto.pdf', false, 'INTERNAL'],
      ['b.pdf', true, undefined]
    ])
    expect(r.data.items[2].error).toBe('PDF dañado')
    expect(importPdf).toHaveBeenCalledTimes(4)
  })

  it('fotos: cada una devuelve su texto OCR para revisarlo, sin trocear', async () => {
    const importImage = vi.fn(async (deps: { store: Store }, subjectId: number, path: string) => ({
      document: deps.store.addDocument({ subjectId, title: path, sourceType: 'image', path }),
      ocrText: `texto de ${path.slice(-5)}`
    }))
    const s = await setup({ core: { importImage: importImage as unknown as CoreFns['importImage'] } })
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: ['C:\\f\\1.png', 'C:\\f\\2.png'] }
    const r = await s.call<Many>('notes:importMany', subj.id, 'image')
    expect(r.ok && r.data.items.map((i) => [i.kind, i.ocrText])).toEqual([
      ['image', 'texto de 1.png'],
      ['image', 'texto de 2.png']
    ])
    expect(r.ok && r.data.items.every((i) => typeof i.documentId === 'number')).toBe(true)
  })

  it('más de 50 archivos de golpe: INVALID sin importar ninguno', async () => {
    const s = await setup({ core: explodingCore })
    const subj = s.store.createSubject('A')
    s.dialog.next = { canceled: false, filePaths: Array.from({ length: 51 }, (_, i) => `C:\\a\\${i}.md`) }
    const r = fail(await s.call('notes:importMany', subj.id, 'text'))
    expect(r.code).toBe('INVALID')
    expect(r.error).toMatch(/50/)
  })

  it('asignatura inexistente: NOT_FOUND antes de abrir el diálogo', async () => {
    const s = await setup({ core: explodingCore })
    expect(fail(await s.call('notes:importMany', 999, 'text')).code).toBe('NOT_FOUND')
    expect(s.dialog.calls).toEqual([])
  })
})

// ------------------------------------------------- (iv) confirmOcr y borrado

describe('notes:confirmOcr', () => {
  async function withQuestion() {
    const s = await setup()
    const subj = s.store.createSubject('A')
    const doc = s.store.addDocument({ subjectId: subj.id, title: 'foto', sourceType: 'image' })
    const [chunk] = s.store.addChunks(doc.id, subj.id, ['La mitocondria produce ATP.'])
    s.store.saveQuestion({
      subjectId: subj.id, chunkId: chunk.id, type: 'vf', prompt: 'P', answer: 'verdadero', explanation: 'E', quote: 'La mitocondria produce ATP.'
    })
    return { s, subj, doc, chunk }
  }

  it('WOULD_DELETE_QUESTIONS con el recuento y sin modificar nada si falta force', async () => {
    const { s, subj, doc } = await withQuestion()
    const r = fail(await s.call('notes:confirmOcr', doc.id, 'Texto corregido por el usuario.'))
    expect(r.code).toBe('WOULD_DELETE_QUESTIONS')
    expect(r.count).toBe(1)
    expect(s.store.listQuestions(subj.id)).toHaveLength(1)
    expect(s.store.listChunks(subj.id)[0].text).toBe('La mitocondria produce ATP.')
    // force:false explícito tampoco procede
    expect(fail(await s.call('notes:confirmOcr', doc.id, 'Otro', false)).code).toBe('WOULD_DELETE_QUESTIONS')
  })

  it('con force:true procede y borra las preguntas', async () => {
    const { s, subj, doc } = await withQuestion()
    const r = await s.call<{ chunkCount: number; deletedQuestions: number }>('notes:confirmOcr', doc.id, 'Texto corregido por el usuario.', true)
    expect(r).toMatchObject({ ok: true, data: { chunkCount: 1, deletedQuestions: 1 } })
    expect(s.store.listQuestions(subj.id)).toHaveLength(0)
    expect(s.store.listChunks(subj.id)[0].text).toBe('Texto corregido por el usuario.')
  })

  it('sin preguntas guardadas no hace falta force', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    const doc = s.store.addDocument({ subjectId: subj.id, title: 'foto', sourceType: 'image' })
    const r = await s.call<{ chunkCount: number }>('notes:confirmOcr', doc.id, 'Algo de texto.')
    expect(r).toMatchObject({ ok: true, data: { chunkCount: 1, deletedQuestions: 0 } })
  })

  it('las preguntas de OTROS documentos no cuentan', async () => {
    const { s, subj } = await withQuestion()
    const other = s.store.addDocument({ subjectId: subj.id, title: 'otra', sourceType: 'image' })
    expect((await s.call('notes:confirmOcr', other.id, 'Texto.')).ok).toBe(true)
    expect(s.store.listQuestions(subj.id)).toHaveLength(1)
  })

  it('documento inexistente: NOT_FOUND', async () => {
    const s = await setup()
    expect(fail(await s.call('notes:confirmOcr', 99, 'x')).code).toBe('NOT_FOUND')
  })
})

describe('apuntes: lectura con ámbito de asignatura', () => {
  it('list incluye documentos sin chunks y notes:chunk exige la asignatura correcta', async () => {
    const s = await setup()
    const a = s.store.createSubject('A')
    const b = s.store.createSubject('B')
    const doc = s.store.addDocument({ subjectId: a.id, title: 'tema', sourceType: 'text' })
    const [c] = s.store.addChunks(doc.id, a.id, ['uno', 'dos'])
    s.store.addDocument({ subjectId: a.id, title: 'foto', sourceType: 'image' })
    const list = await s.call<Array<{ title: string; chunkCount: number }>>('notes:list', a.id)
    expect(list).toMatchObject({ ok: true, data: [{ title: 'tema', chunkCount: 2 }, { title: 'foto', chunkCount: 0 }] })
    expect(await s.call('notes:chunk', a.id, c.id)).toMatchObject({ ok: true, data: { id: c.id, documentTitle: 'tema', text: 'uno' } })
    expect(fail(await s.call('notes:chunk', b.id, c.id)).code).toBe('NOT_FOUND')
    expect(await s.call('notes:chunks', b.id)).toEqual({ ok: true, data: [] })
    expect(((await s.call<unknown[]>('notes:chunks', a.id, doc.id)) as { data: unknown[] }).data).toHaveLength(2)
  })

  it('deleteDocument solo borra documentos de la asignatura indicada', async () => {
    const s = await setup()
    const a = s.store.createSubject('A')
    const b = s.store.createSubject('B')
    const doc = s.store.addDocument({ subjectId: a.id, title: 'tema', sourceType: 'text' })
    expect(fail(await s.call('notes:deleteDocument', b.id, doc.id)).code).toBe('NOT_FOUND')
    expect(s.store.getDocument(doc.id)).toBeDefined()
    expect(await s.call('notes:deleteDocument', a.id, doc.id)).toEqual({ ok: true, data: null })
    expect(s.store.getDocument(doc.id)).toBeUndefined()
  })
})

// --------------------------------------------------------------- generación

describe('quiz:generate / quiz:cancel', () => {
  it('propaga modelUnavailable del core', async () => {
    const generateQuestions = vi.fn(async () => ({ questions: [], discarded: 2, reasons: ['error del modelo: x'], insufficient: false, modelUnavailable: true }))
    const s = await setup({ core: { generateQuestions: generateQuestions as unknown as CoreFns['generateQuestions'] } })
    const r = await s.call('quiz:generate', { requestId: 'req-mu', subjectId: 1, type: 'vf', count: 2 })
    expect(r).toMatchObject({ ok: true, data: { insufficient: false, modelUnavailable: true } })
  })

  it('emite progreso al emisor con el requestId y devuelve el resultado del core', async () => {
    const generateQuestions = vi.fn(async (_d, _req, onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 2)
      onProgress?.(2, 2)
      return { questions: [], discarded: 1, reasons: ['sin material'], insufficient: true }
    })
    const s = await setup({ core: { generateQuestions: generateQuestions as unknown as CoreFns['generateQuestions'] } })
    const r = await s.call('quiz:generate', { requestId: 'req-1', subjectId: 1, type: 'vf', count: 2 })
    expect(r).toEqual({ ok: true, data: { questions: [], discarded: 1, reasons: ['sin material'], insufficient: true } })
    expect(s.sent).toEqual([
      { channel: events.quizProgress, payload: { requestId: 'req-1', done: 1, total: 2 } },
      { channel: events.quizProgress, payload: { requestId: 'req-1', done: 2, total: 2 } }
    ])
    // el requestId no se filtra al core
    expect(generateQuestions.mock.calls[0][1]).toEqual({ subjectId: 1, type: 'vf', count: 2 })
  })

  it('acepta type "practico" y lo pasa tal cual al core', async () => {
    const generateQuestions = vi.fn(async () => ({ questions: [], discarded: 0, reasons: ['sin material suficiente para ejercicios prácticos'], insufficient: true }))
    const s = await setup({ core: { generateQuestions: generateQuestions as unknown as CoreFns['generateQuestions'] } })
    const r = await s.call('quiz:generate', { requestId: 'p1', subjectId: 1, type: 'practico', count: 2, topic: 'ohm' })
    expect(r).toEqual({ ok: true, data: { questions: [], discarded: 0, reasons: ['sin material suficiente para ejercicios prácticos'], insufficient: true } })
    expect((generateQuestions.mock.calls[0] as unknown as unknown[])[1]).toEqual({ subjectId: 1, type: 'practico', count: 2, topic: 'ohm' })
  })

  it('quiz:cancel aborta la señal del requestId correcto y libera el id', async () => {
    let started!: () => void
    const running = new Promise<void>((res) => (started = res))
    const generateQuestions = async (_d: unknown, _r: unknown, _p: unknown, signal?: AbortSignal) => {
      started()
      await new Promise<void>((res) => signal!.addEventListener('abort', () => res()))
      return { questions: [], discarded: 0, reasons: [], insufficient: false }
    }
    const s = await setup({ core: { generateQuestions: generateQuestions as unknown as CoreFns['generateQuestions'] } })
    const pending = s.call('quiz:generate', { requestId: 'a', subjectId: 1, type: 'vf', count: 2 })
    await running
    // mismo id en curso: rechazado
    expect(fail(await s.call('quiz:generate', { requestId: 'a', subjectId: 1, type: 'vf', count: 2 })).code).toBe('INVALID')
    expect(await s.call('quiz:cancel', 'otro')).toEqual({ ok: true, data: { cancelled: false } })
    expect(await s.call('quiz:cancel', 'a')).toEqual({ ok: true, data: { cancelled: true } })
    expect((await pending).ok).toBe(true)
    expect(await s.call('quiz:cancel', 'a')).toEqual({ ok: true, data: { cancelled: false } })
  })

  it('libera el requestId también si el core lanza', async () => {
    const s = await setup({ core: { generateQuestions: (async () => { throw new Error('fallo') }) as unknown as CoreFns['generateQuestions'] } })
    const req = { requestId: 'z', subjectId: 1, type: 'vf', count: 1 }
    expect(fail(await s.call('quiz:generate', req)).error).toBe('fallo')
    expect(fail(await s.call('quiz:generate', req)).error).toBe('fallo') // no "id en curso"
  })

  it('un envío de progreso que lanza (ventana cerrada) no rompe la generación', async () => {
    const generateQuestions = async (_d: unknown, _r: unknown, onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 1)
      return { questions: [], discarded: 0, reasons: [], insufficient: false }
    }
    const s = await setup({ core: { generateQuestions: generateQuestions as unknown as CoreFns['generateQuestions'] } })
    const { handlers, registrar } = fakeRegistrar()
    registerIpc(s.ctx, registrar)
    const deadEvent = { sender: { send: () => { throw new Error('Object has been destroyed') }, isDestroyed: () => false } }
    const r = (await handlers.get(channels.quizGenerate)!(deadEvent, { requestId: 'q', subjectId: 1, type: 'vf', count: 1 })) as Result<unknown>
    expect(r.ok).toBe(true)
  })
})

// ------------------------------------------------------------- (v) corrección

describe('quiz:submit', () => {
  async function two() {
    const s = await setup()
    const a = s.store.createSubject('A')
    const b = s.store.createSubject('B')
    const mk = (subjectId: number, quote: string) => {
      const doc = s.store.addDocument({ subjectId, title: 't', sourceType: 'text' })
      const [chunk] = s.store.addChunks(doc.id, subjectId, [quote])
      return s.store.saveQuestion({ subjectId, chunkId: chunk.id, type: 'vf', prompt: 'P', answer: 'verdadero', explanation: 'Porque sí.', quote })
    }
    const qa = mk(a.id, 'La mitocondria produce ATP.')
    const qb = mk(b.id, 'El núcleo guarda el ADN.')
    const attA = s.store.startAttempt(a.id)
    const attB = s.store.startAttempt(b.id)
    return { s, a, b, qa, qb, attA, attB }
  }

  it('corrige con el core, guarda la respuesta y devuelve el GradeResult fiel', async () => {
    const { s, a, qa, attA } = await two()
    const r = await s.call('quiz:submit', { subjectId: a.id, attemptId: attA, questionId: qa.id, answer: 'Verdadero' })
    expect(r).toEqual({
      ok: true,
      data: { correct: true, feedback: 'Correcto. Porque sí.', quote: 'La mitocondria produce ATP.', verified: true }
    })
    const [att] = s.store.listAttempts(a.id)
    expect(att.answers).toHaveLength(1)
    expect(att.answers[0]).toMatchObject({ questionId: qa.id, userAnswer: 'Verdadero', correct: true, feedbackQuote: 'La mitocondria produce ATP.' })
  })

  it('rechaza una pregunta de otra asignatura y no guarda nada', async () => {
    const { s, a, b, qa, qb, attA, attB } = await two()
    expect(fail(await s.call('quiz:submit', { subjectId: a.id, attemptId: attA, questionId: qb.id, answer: 'x' })).code).toBe('NOT_FOUND')
    expect(fail(await s.call('quiz:submit', { subjectId: b.id, attemptId: attB, questionId: qa.id, answer: 'x' })).code).toBe('NOT_FOUND')
    // intento de otra asignatura con una pregunta propia
    expect(fail(await s.call('quiz:submit', { subjectId: a.id, attemptId: attB, questionId: qa.id, answer: 'x' })).code).toBe('NOT_FOUND')
    expect(s.store.listAttempts(a.id)[0].answers).toEqual([])
    expect(s.store.listAttempts(b.id)[0].answers).toEqual([])
  })

  it('no califica dos veces la misma pregunta ni en un intento terminado', async () => {
    const { s, a, qa, attA } = await two()
    const req = { subjectId: a.id, attemptId: attA, questionId: qa.id, answer: 'verdadero' }
    expect((await s.call('quiz:submit', req)).ok).toBe(true)
    expect(fail(await s.call('quiz:submit', req)).code).toBe('INVALID')
    expect(await s.call('quiz:finishAttempt', a.id, attA)).toEqual({ ok: true, data: null })
    const att2 = s.store.startAttempt(a.id)
    await s.call('quiz:finishAttempt', a.id, att2)
    expect(fail(await s.call('quiz:submit', { ...req, attemptId: att2 })).code).toBe('INVALID')
    expect(s.store.listAttempts(a.id)[0].finishedAt).not.toBeNull()
  })

  it('startAttempt / finishAttempt / history respetan la asignatura', async () => {
    const { s, a, b, qa, attA } = await two()
    expect(fail(await s.call('quiz:startAttempt', 999)).code).toBe('NOT_FOUND')
    expect(fail(await s.call('quiz:finishAttempt', b.id, attA)).code).toBe('NOT_FOUND')
    await s.call('quiz:submit', { subjectId: a.id, attemptId: attA, questionId: qa.id, answer: 'falso' })
    const h = await s.call<Array<{ id: number; answers: Array<{ prompt: string; correct: boolean }> }>>('history:list', a.id)
    expect(h).toMatchObject({ ok: true, data: [{ id: attA, answers: [{ prompt: 'P', correct: false }] }] })
    expect(await s.call('history:list', 999)).toEqual({ ok: true, data: [] })
  })
})

// ------------------------------------------------------------------- system

describe('system', () => {
  it('health devuelve el estado del proveedor y el modelo configurado', async () => {
    const s = await setup({ ctx: { llm: llm({ health: async () => ({ ok: false, message: 'Ollama apagado' }) }), model: 'm:1' } })
    expect(await s.call('system:health')).toEqual({ ok: true, data: { ok: false, message: 'Ollama apagado', model: 'm:1' } })
    expect(await s.call('system:config')).toEqual({ ok: true, data: { model: 'm:1' } })
  })

  it('health nunca se cuelga: tope duro aunque el proveedor no responda', async () => {
    const s = await setup({ ctx: { llm: llm({ health: () => new Promise(() => {}) }), healthTimeoutMs: 50 } })
    const t0 = Date.now()
    const r = await s.call<{ ok: boolean; message: string }>('system:health')
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(r).toMatchObject({ ok: true, data: { ok: false } })
  })
})

// ------------------------------------------------------ (vi) excepciones

describe('manejo de excepciones', () => {
  it('toda excepción de un handler se convierte en {ok:false,error} sin lanzar ni filtrar la pila', async () => {
    const store = await openStore()
    const throwing = new Proxy(store, {
      get: () => () => {
        const e = new Error('disco lleno')
        e.stack = 'Error: disco lleno\n    at secret (C:\\Users\\x\\proyecto\\src\\core\\store.ts:10:5)'
        throw e
      }
    })
    const s = await setup({ store: throwing, ctx: { llm: llm({ health: async () => { throw new Error('x') } }) } })
    const valid: Record<string, unknown[]> = {
      'subjects:list': [], 'subjects:create': ['A'], 'notes:import': [1, 'text'], 'notes:importMany': [1, 'text'], 'notes:confirmOcr': [1, 'x'],
      'notes:list': [1], 'notes:chunks': [1], 'notes:chunk': [1, 1], 'notes:deleteDocument': [1, 1],
      'quiz:generate': [{ requestId: 'r', subjectId: 1, type: 'vf', count: 1 }], 'quiz:cancel': ['r'],
      'quiz:startAttempt': [1], 'quiz:finishAttempt': [1, 1],
      'quiz:submit': [{ subjectId: 1, attemptId: 1, questionId: 1, answer: 'a' }], 'history:list': [1],
      'concepts:list': [1], 'concepts:build': [{ requestId: 'r', subjectId: 1 }], 'concepts:cancel': ['r'],
      'mobile:start': [{ subjectId: 1 }], 'mobile:stop': [],
      'system:health': [], 'system:config': []
    }
    expect(Object.keys(valid).sort()).toEqual(Object.values(channels).sort())
    for (const [channel, args] of Object.entries(valid)) {
      const r = await s.call(channel, ...args) // no debe lanzar
      expect(typeof r.ok).toBe('boolean')
      if (!r.ok) {
        expect(r.error).not.toMatch(/\bat \S+ \(|\.ts:\d+|stack/i)
        expect(r.error).not.toContain('C:\\Users')
      }
    }
    const r = fail(await s.call('subjects:list'))
    expect(r.error).toBe('disco lleno')
    expect(r.code).toBe('INTERNAL')
  })

  it('valores lanzados que no son Error producen un mensaje genérico', async () => {
    for (const thrown of ['cadena', undefined, { a: 1 }, null]) {
      const s = await setup({ core: { gradeAnswer: (async () => { throw thrown }) as unknown as CoreFns['gradeAnswer'] } })
      const a = s.store.createSubject('A')
      const doc = s.store.addDocument({ subjectId: a.id, title: 't', sourceType: 'text' })
      const [c] = s.store.addChunks(doc.id, a.id, ['hola mundo'])
      const q = s.store.saveQuestion({ subjectId: a.id, chunkId: c.id, type: 'desarrollo', prompt: 'P', answer: 'R', explanation: 'E', quote: 'hola' })
      const att = s.store.startAttempt(a.id)
      const r = fail(await s.call('quiz:submit', { subjectId: a.id, attemptId: att, questionId: q.id, answer: 'x' }))
      expect(r.error).toMatch(/error/i)
      expect(r.error).not.toContain('[object')
    }
  })

  it('el error de un mensaje enorme se acota', async () => {
    const s = await setup({ store: new Proxy(await openStore(), { get: () => () => { throw new Error('m'.repeat(5000)) } }) })
    expect(fail(await s.call('subjects:list')).error.length).toBeLessThanOrEqual(500)
  })
})
