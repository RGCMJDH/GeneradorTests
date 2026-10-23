import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore, type Store } from '@core/store'
import type { UploadServer, UploadServerOptions } from '@core/mobile'
import { channels, events, type Failure, type MobileSession, type Result } from '../../src/shared/api'
import { registerIpc } from '../../src/main/ipc'
import { realCore, type CoreFns, type IpcContext, type MobileDeps, type Registrar } from '../../src/main/ipc/context'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FOTO = readFileSync(join(ROOT, 'tests/fixtures/foto-apuntes.png'))
const URL_A = `http://192.168.1.40:5555/u/${'a'.repeat(32)}`

type Handler = (event: unknown, ...args: unknown[]) => unknown
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface FakeServer extends UploadServer {
  opts: UploadServerOptions
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>
}

async function setup(over: { importImage?: CoreFns['importImage']; mobile?: Partial<MobileDeps>; userDataDir?: string } = {}) {
  const userDataDir = over.userDataDir ?? mkdtempSync(join(tmpdir(), 'gt-ipc-mobile-'))
  dirs.push(userDataDir)
  const store: Store = await openStore()
  const servers: FakeServer[] = []
  const mobile: MobileDeps = {
    startUploadServer: vi.fn(async (opts: UploadServerOptions) => {
      const server: FakeServer = {
        opts,
        url: URL_A,
        token: 'a'.repeat(32),
        expiresAt: Date.now() + 600_000,
        stop: vi.fn(async () => undefined)
      }
      servers.push(server)
      return server
    }),
    // El QR es el real: se comprueba que sale un PNG de verdad.
    qrDataUrl: async (url) => (await import('qrcode')).default.toDataURL(url, { errorCorrectionLevel: 'M' }),
    ...over.mobile
  }
  const ctx: IpcContext = {
    store,
    llm: { generateJson: async () => ({}), health: async () => ({ ok: true, message: 'ok' }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    userDataDir,
    model: 'm',
    core: { ...realCore, ...(over.importImage ? { importImage: over.importImage } : {}) },
    mobile
  }
  const handlers = new Map<string, Handler>()
  const registrar: Registrar = { handle: (c, l) => void handlers.set(c, l as Handler) }
  const ipc = registerIpc(ctx, registrar)
  const sent: Array<{ channel: string; payload: unknown }> = []
  const listeners = new Map<string, Array<() => void>>()
  const sender = {
    send: (channel: string, payload: unknown) => void sent.push({ channel, payload }),
    isDestroyed: () => false,
    once: (e: string, cb: () => void) => void listeners.set(e, [...(listeners.get(e) ?? []), cb]),
    on: (e: string, cb: () => void) => void listeners.set(e, [...(listeners.get(e) ?? []), cb]),
    removeListener: (e: string, cb: () => void) => void listeners.set(e, (listeners.get(e) ?? []).filter((x) => x !== cb))
  }
  const call = async <T>(channel: string, ...args: unknown[]): Promise<Result<T>> => (await handlers.get(channel)!({ sender }, ...args)) as Result<T>
  const emit = (e: string): void => (listeners.get(e) ?? []).slice().forEach((cb) => cb())
  const inbox = join(userDataDir, 'mobile-inbox')
  return { ctx, store, mobile, servers, call, sent, ipc, emit, listeners, userDataDir, inbox, handlers }
}

const failure = (r: Result<unknown>): Failure => {
  expect(r.ok).toBe(false)
  return r as Failure
}
const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : [])
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('mobile:start / mobile:stop', () => {
  it('start devuelve url + QR PNG (data URL) + expiresAt, y arranca el servidor sin host ni puerto', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    const r = await s.call<MobileSession>(channels.mobileStart, { subjectId: subj.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.url).toBe(URL_A)
    expect(r.data.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const png = Buffer.from(r.data.qrDataUrl.split(',')[1]!, 'base64')
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(r.data.expiresAt).toBeGreaterThan(Date.now())
    const opts = s.servers[0]!.opts
    expect(Object.keys(opts).sort()).toEqual(['onExpire', 'onImage']) // sin host/puerto/límites del renderer
  })

  it('el QR se genera con corrección de errores M', async () => {
    const qrDataUrl = vi.fn(async () => 'data:image/png;base64,AAAA')
    const s = await setup({ mobile: { qrDataUrl } })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    expect(qrDataUrl).toHaveBeenCalledWith(URL_A)
    const src = readFileSync(join(ROOT, 'src/main/ipc/mobile.ts'), 'utf8')
    expect(src).toMatch(/errorCorrectionLevel:\s*'M'/)
  })

  it('una asignatura inexistente: NOT_FOUND y no se abre ningún servidor', async () => {
    const s = await setup()
    expect(failure(await s.call(channels.mobileStart, { subjectId: 99 })).code).toBe('NOT_FOUND')
    expect(s.mobile.startUploadServer).not.toHaveBeenCalled()
  })

  it.each([
    ['no objeto', ['hola']],
    ['null', [null]],
    ['array', [[1]]],
    ['sin argumentos', []],
    ['subjectId negativo', [{ subjectId: -1 }]],
    ['subjectId decimal', [{ subjectId: 1.5 }]],
    ['subjectId string', [{ subjectId: '1' }]],
    ['clave extra: host', [{ subjectId: 1, host: '0.0.0.0' }]],
    ['clave extra: port', [{ subjectId: 1, port: 80 }]],
    ['clave extra: path', [{ subjectId: 1, path: 'C:\\x' }]],
    ['argumentos de más', [{ subjectId: 1 }, 'x']]
  ])('start rechaza %s con INVALID sin abrir servidor', async (_why, args) => {
    const s = await setup()
    s.store.createSubject('A')
    expect(failure(await s.call(channels.mobileStart, ...args)).code).toBe('INVALID')
    expect(s.mobile.startUploadServer).not.toHaveBeenCalled()
  })

  it('stop rechaza argumentos', async () => {
    const s = await setup()
    expect(failure(await s.call(channels.mobileStop, 'x')).code).toBe('INVALID')
  })

  it('solo hay una sesión: repetir start para la misma asignatura devuelve la misma URL', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    const a = await s.call<MobileSession>(channels.mobileStart, { subjectId: subj.id })
    const b = await s.call<MobileSession>(channels.mobileStart, { subjectId: subj.id })
    expect(a).toEqual(b)
    expect(s.servers).toHaveLength(1)
  })

  it('dos start simultáneos no abren dos servidores', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await Promise.all([s.call(channels.mobileStart, { subjectId: subj.id }), s.call(channels.mobileStart, { subjectId: subj.id })])
    expect(s.servers).toHaveLength(1)
  })

  it('start para otra asignatura detiene la sesión anterior antes de abrir la nueva', async () => {
    const s = await setup()
    const a = s.store.createSubject('A')
    const b = s.store.createSubject('B')
    await s.call(channels.mobileStart, { subjectId: a.id })
    await s.call(channels.mobileStart, { subjectId: b.id })
    expect(s.servers).toHaveLength(2)
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
    expect(s.servers[1]!.stop).not.toHaveBeenCalled()
  })

  it('stop detiene el servidor y es idempotente', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    expect(await s.call(channels.mobileStop)).toEqual({ ok: true, data: null })
    expect(await s.call(channels.mobileStop)).toEqual({ ok: true, data: null })
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('si el servidor no arranca (sin wifi) devuelve el mensaje y se puede reintentar', async () => {
    const startUploadServer = vi
      .fn<MobileDeps['startUploadServer']>()
      .mockRejectedValueOnce(new Error('No se encontró una red local (wifi)'))
      .mockImplementation(async () => ({ url: URL_A, token: 'a'.repeat(32), expiresAt: Date.now() + 1000, stop: async () => undefined }))
    const s = await setup({ mobile: { startUploadServer } })
    const subj = s.store.createSubject('A')
    expect(failure(await s.call(channels.mobileStart, { subjectId: subj.id })).error).toBe('No se encontró una red local (wifi)')
    expect((await s.call(channels.mobileStart, { subjectId: subj.id })).ok).toBe(true)
  })

  it('si falla el QR se cierra el servidor recién abierto', async () => {
    const s = await setup({ mobile: { qrDataUrl: async () => { throw new Error('qr roto') } } })
    const subj = s.store.createSubject('A')
    expect(failure(await s.call(channels.mobileStart, { subjectId: subj.id })).ok).toBe(false)
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
    expect((await s.call(channels.mobileStop)).ok).toBe(true)
  })
})

describe('foto recibida del móvil', () => {
  /** importImage falso: comprueba que el archivo existe en ese instante y deja terminar el OCR a voluntad. */
  function ocrProbe() {
    const seen: Array<{ path: string; existed: boolean; bytes: Buffer }> = []
    let finish: (v: string | Error) => void = () => undefined
    const importImage = vi.fn(async (deps: { store: Store }, subjectId: number, path: string) => {
      seen.push({ path, existed: existsSync(path), bytes: existsSync(path) ? readFileSync(path) : Buffer.alloc(0) })
      const out = await new Promise<string | Error>((r) => (finish = r))
      if (out instanceof Error) throw out
      return { document: deps.store.addDocument({ subjectId, title: 'foto-movil', sourceType: 'image', path }), ocrText: out }
    })
    return { importImage: importImage as unknown as CoreFns['importImage'], seen, finish: (v: string | Error) => finish(v) }
  }

  it('escribe un archivo temporal con nombre generado, hace OCR, lo borra y avisa con mobile:image', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })

    await s.servers[0]!.opts.onImage(FOTO, '../../evil.png')
    await vi.waitFor(() => expect(probe.seen).toHaveLength(1))
    const { path, existed, bytes } = probe.seen[0]!
    expect(existed).toBe(true)
    expect(Buffer.compare(bytes, FOTO)).toBe(0)
    expect(dirname(path)).toBe(s.inbox)
    expect(path).toMatch(/foto-movil-[0-9a-f]{16}\.png$/)
    expect(path).not.toContain('evil')
    expect(s.sent).toEqual([]) // el evento llega al terminar el OCR

    probe.finish('Texto reconocido')
    await vi.waitFor(() => expect(s.sent).toHaveLength(1))
    expect(s.sent[0]).toEqual({ channel: events.mobileImage, payload: { subjectId: subj.id, documentId: 1, ocrText: 'Texto reconocido' } })
    expect(existsSync(path)).toBe(false)
    expect(files(s.inbox)).toEqual([])
  })

  it('onImage vuelve en cuanto el archivo está escrito: el móvil no espera al OCR', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    await expect(s.servers[0]!.opts.onImage(FOTO, 'a.png')).resolves.toBeUndefined() // el OCR sigue pendiente
    expect(s.sent).toEqual([])
    probe.finish('x')
    await vi.waitFor(() => expect(s.sent).toHaveLength(1))
  })

  it('si el OCR falla: evento con error (mensaje, sin ruta ni pila) y el temporal también se borra', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    await s.servers[0]!.opts.onImage(FOTO, 'a.png')
    await vi.waitFor(() => expect(probe.seen).toHaveLength(1))
    probe.finish(new Error('No se pudo reconocer el texto de «foto-movil-1.png»: fallo'))
    await vi.waitFor(() => expect(s.sent).toHaveLength(1))
    const payload = s.sent[0]!.payload as { subjectId: number; error: string }
    expect(payload.subjectId).toBe(subj.id)
    expect(payload.error).toMatch(/No se pudo reconocer/)
    expect(JSON.stringify(payload)).not.toContain(s.userDataDir)
    expect(files(s.inbox)).toEqual([])
  })

  it('el temporal ya no existe cuando se envía el evento', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    const atSend: boolean[] = []
    const sender = { send: () => atSend.push(files(s.inbox).length > 0), isDestroyed: () => false }
    await s.handlers.get(channels.mobileStart)!({ sender }, { subjectId: subj.id }) // misma sesión: pasa a usar este emisor
    await s.servers[0]!.opts.onImage(FOTO, 'a.png')
    await vi.waitFor(() => expect(probe.seen).toHaveLength(1))
    probe.finish('x')
    await vi.waitFor(() => expect(atSend).toEqual([false]))
  })

  it('usa la asignatura fijada al arrancar, aunque luego se pida otra', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const a = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: a.id })
    await s.servers[0]!.opts.onImage(FOTO, 'a.png')
    await vi.waitFor(() => expect(probe.seen).toHaveLength(1))
    probe.finish('x')
    await vi.waitFor(() => expect(s.sent).toHaveLength(1))
    expect(s.store.listDocuments(a.id)).toHaveLength(1)
    expect((s.sent[0]!.payload as { subjectId: number }).subjectId).toBe(a.id)
  })

  it('el nombre que manda el móvil nunca se usa como ruta ni como nombre de archivo', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    for (const name of ['..\\..\\x.png', '/etc/passwd', 'a:b.png', 'CON.png']) {
      const done = s.servers[0]!.opts.onImage(FOTO, name)
      await done
    }
    await vi.waitFor(() => expect(probe.seen).toHaveLength(4))
    for (const { path } of probe.seen) {
      expect(dirname(path)).toBe(s.inbox)
      expect(path.slice(s.inbox.length)).toMatch(/^[\\/]foto-movil-[0-9a-f]{16}\.png$/)
    }
    expect(new Set(probe.seen.map((p) => p.path)).size).toBe(4)
    const src = readFileSync(join(ROOT, 'src/main/ipc/mobile.ts'), 'utf8')
    expect(src).not.toMatch(/join\([^)]*filename/)
  })

  it('bytes que no son imagen (o HEIC) no llegan a escribirse ni a OCR', async () => {
    const probe = ocrProbe()
    const s = await setup({ importImage: probe.importImage })
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    await expect(s.servers[0]!.opts.onImage(Buffer.from('MZ ejecutable'), 'a.exe')).rejects.toThrow()
    await expect(s.servers[0]!.opts.onImage(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(8)]), 'a.heic')).rejects.toThrow()
    expect(files(s.inbox)).toEqual([])
    expect(probe.seen).toEqual([])
  })

  it('elimina temporales huérfanos de más de una hora al arrancar, y respeta los recientes', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    mkdirSync(s.inbox, { recursive: true })
    const old = join(s.inbox, 'foto-movil-viejo.png')
    const fresh = join(s.inbox, 'foto-movil-reciente.png')
    writeFileSync(old, FOTO)
    writeFileSync(fresh, FOTO)
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000)
    utimesSync(old, twoHoursAgo, twoHoursAgo)
    await s.call(channels.mobileStart, { subjectId: subj.id })
    expect(files(s.inbox).sort()).toEqual(['foto-movil-reciente.png'])
  })
})

describe('apagado de la sesión', () => {
  it('al caducar el servidor (onExpire) se avisa con mobile:stopped y la sesión desaparece', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    s.servers[0]!.opts.onExpire!()
    await flush()
    expect(s.sent).toEqual([{ channel: events.mobileStopped, payload: { reason: 'expired' } }])
    expect(await s.call(channels.mobileStop)).toEqual({ ok: true, data: null })
    expect(s.servers[0]!.stop).not.toHaveBeenCalled() // ya estaba parado por la caducidad
    await s.call(channels.mobileStart, { subjectId: subj.id })
    expect(s.servers).toHaveLength(2) // empieza una sesión nueva
  })

  it('dispose() (before-quit) detiene el servidor', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    await s.ipc.dispose()
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
    await s.ipc.dispose() // idempotente
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('al destruirse la ventana se detiene el servidor', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    s.emit('destroyed')
    await flush()
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
    expect(s.listeners.get('did-start-loading') ?? []).toEqual([]) // listeners retirados
  })

  it('al recargar la página (la interfaz pierde la sesión) se detiene el servidor', async () => {
    const s = await setup()
    const subj = s.store.createSubject('A')
    await s.call(channels.mobileStart, { subjectId: subj.id })
    s.emit('did-start-loading')
    await flush()
    expect(s.servers[0]!.stop).toHaveBeenCalledTimes(1)
  })

  it('main/index.ts cierra el servidor en before-quit', () => {
    const src = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    expect(src).toMatch(/app\.on\('before-quit'[\s\S]{0,120}dispose\(\)/)
    expect(src).toMatch(/registerIpc\(ctx, ipcMain\)/)
  })
})
