import { randomBytes } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { detectImageType, type ImageKind } from '@core/imageType'
import { startUploadServer, UploadRejected, type UploadServer } from '@core/mobile'
import { channels, events, type MobileImageEvent, type MobileSession } from '../../shared/api'
import { handle, safeMessage, trySend } from './common'
import type { IpcContext, MobileDeps, Registrar, SenderLike } from './context'
import { ingestImageFromPath } from './notes'
import { requireSubject } from './subjects'
import { arity, id, record } from './validate'

export const realMobile: MobileDeps = {
  startUploadServer,
  qrDataUrl: (url) => QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
}

const EXTENSION: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', bmp: 'bmp', tiff: 'tif', webp: 'webp' }
const INBOX = 'mobile-inbox'
/** Un temporal que sobrevive a su sesión (cierre brusco durante el OCR) se borra al arrancar la siguiente, pasada esta edad. */
const STALE_MS = 60 * 60 * 1000
/** Fotos esperando OCR (la que se procesa + las que esperan). Cada OCR carga Tesseract (idiomas + WASM): de uno en uno y con cola acotada. */
const MAX_PENDING_OCR = 5
const QUEUE_FULL = 'Espera a que se procesen las fotos anteriores'

interface Session {
  subjectId: number
  server: UploadServer
  info: MobileSession
  sender: SenderLike
  detach(): void
}

/** Borra fotos huérfanas antiguas de la bandeja. Mejor esfuerzo: nunca impide arrancar la sesión. */
async function sweepInbox(dir: string): Promise<void> {
  try {
    for (const name of await readdir(dir)) {
      const file = join(dir, name)
      const st = await stat(file).catch(() => null)
      if (st?.isFile() && Date.now() - st.mtimeMs > STALE_MS) await rm(file, { force: true })
    }
  } catch {
    /* la carpeta puede no existir todavía */
  }
}

export function registerMobile(ctx: IpcContext, r: Registrar): { dispose(): Promise<void> } {
  const deps = ctx.mobile ?? realMobile
  const inbox = join(ctx.userDataDir, INBOX)
  let session: Session | null = null
  // Cola de OCR: estrictamente una foto a la vez (el temporal espera en disco hasta que le toca; se borra en runOcr).
  let ocrChain: Promise<unknown> = Promise.resolve()
  let pendingOcr = 0
  let generation = 0 // sube en dispose(): lo que seguía en cola se descarta
  // start/stop se encadenan: nunca hay dos servidores a la vez aunque lleguen peticiones simultáneas.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  }

  async function close(s: Session): Promise<void> {
    s.detach()
    if (session === s) session = null
    await s.server.stop()
  }

  /** Para la sesión si la ventana desaparece o se recarga (la interfaz ya no podría mostrarla ni detenerla). */
  function attach(s: Session): void {
    const gone = (): void => void serial(() => (session === s ? close(s) : Promise.resolve())).catch(() => undefined)
    s.detach()
    s.sender.once?.('destroyed', gone)
    s.sender.on?.('did-start-loading', gone)
    s.detach = () => {
      s.sender.removeListener?.('destroyed', gone)
      s.sender.removeListener?.('did-start-loading', gone)
    }
  }

  /** OCR en segundo plano: el móvil ya recibió su 200. El temporal se borra siempre, antes de avisar a la interfaz. */
  async function runOcr(s: { subjectId: number; sender: () => SenderLike }, path: string): Promise<void> {
    let payload: MobileImageEvent
    try {
      const { documentId, ocrText } = await ingestImageFromPath(ctx, s.subjectId, path)
      payload = { subjectId: s.subjectId, documentId, ocrText }
    } catch (e) {
      payload = { subjectId: s.subjectId, error: safeMessage(e) }
    } finally {
      await rm(path, { force: true }).catch(() => undefined)
    }
    trySend({ sender: s.sender() }, events.mobileImage, payload)
  }

  function enqueueOcr(s: { subjectId: number; sender: () => SenderLike }, path: string): void {
    const gen = generation
    pendingOcr++
    ocrChain = ocrChain
      .then(() => (gen === generation ? runOcr(s, path) : rm(path, { force: true })))
      .catch(() => undefined)
      .finally(() => {
        pendingOcr--
      })
  }

  async function receive(s: { subjectId: number; sender: () => SenderLike }, data: Buffer): Promise<void> {
    const kind = detectImageType(data)
    if (kind === null || kind === 'heic') throw new Error('Formato de imagen no válido.')
    if (pendingOcr >= MAX_PENDING_OCR) throw new UploadRejected(429, QUEUE_FULL) // antes de escribir nada en disco
    await mkdir(inbox, { recursive: true })
    // Nombre generado aquí: nada de lo que envía el móvil (nombre, tipo) forma parte de la ruta.
    const path = join(inbox, `foto-movil-${randomBytes(8).toString('hex')}.${EXTENSION[kind]}`)
    await writeFile(path, data, { flag: 'wx' })
    enqueueOcr(s, path)
  }

  async function start(subjectId: number, sender: SenderLike): Promise<MobileSession> {
    if (session?.subjectId === subjectId) {
      session.sender = sender
      attach(session)
      return session.info
    }
    if (session) await close(session)
    await sweepInbox(inbox)

    const live: { session?: Session } = {}
    const target = { subjectId, sender: () => live.session?.sender ?? sender }
    const server = await deps.startUploadServer({
      onImage: (data) => receive(target, data),
      checkCapacity: () => (pendingOcr >= MAX_PENDING_OCR ? QUEUE_FULL : null),
      onExpire: () => {
        const s = live.session
        if (!s || session !== s) return
        s.detach()
        session = null
        trySend({ sender: s.sender }, events.mobileStopped, { reason: 'expired' })
      }
    })
    let qrDataUrl: string
    try {
      qrDataUrl = await deps.qrDataUrl(server.url)
    } catch (e) {
      await server.stop()
      throw e
    }
    const s: Session = { subjectId, server, sender, info: { url: server.url, qrDataUrl, expiresAt: server.expiresAt }, detach: () => undefined }
    live.session = s
    session = s
    attach(s)
    return s.info
  }

  handle(r, channels.mobileStart, (event, args) => {
    arity(args, 1)
    const subjectId = id(record(args[0], ['subjectId'], 'La petición')['subjectId'], 'subjectId')
    requireSubject(ctx, subjectId)
    return serial(() => start(subjectId, event.sender))
  })

  handle(r, channels.mobileStop, (_e, args) => {
    arity(args, 0)
    return serial(async () => {
      if (session) await close(session)
      return null
    })
  })

  return {
    dispose: () =>
      serial(async () => {
        generation++
        if (session) await close(session)
      })
  }
}
