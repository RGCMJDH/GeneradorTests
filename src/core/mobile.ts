// Servidor HTTP efímero para recibir fotos desde el móvil. Sin imports de Electron ni de fs/path:
// el servidor solo entrega bytes a `onImage`; qué se hace con ellos (y dónde) lo decide el proceso principal.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces as osNetworkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { Socket } from 'node:net'
import { detectImageType, readImageSize } from './imageType'
import { renderUploadPage } from './mobilePage'
import { pickLanAddress, sanitizeFilename } from './mobileUtil'

export { pickLanAddress, sanitizeFilename }

export interface UploadServerOptions {
  /** Recibe los bytes ya validados. Si la promesa se rechaza, el móvil recibe un 500 genérico. */
  onImage: (data: Buffer, filename: string) => Promise<void>
  /** 0 (por defecto) = puerto efímero elegido por el sistema. */
  port?: number
  /** Solo para pruebas. Por defecto, la IPv4 de la red local; nunca 0.0.0.0. */
  host?: string
  /** Por defecto 15 MB. */
  maxBytes?: number
  /** Por defecto 10 minutos: pasado ese tiempo el servidor se apaga solo. */
  ttlMs?: number
  /** Subidas aceptadas durante la vida del servidor; por defecto 20. */
  maxUploads?: number
  /** Plazo total para recibir cabeceras y cuerpo (anti-slowloris); por defecto 30 s. */
  requestTimeoutMs?: number
  /** Tope de píxeles (ancho x alto, leídos de la cabecera) antes de aceptar la foto; por defecto 40 millones. */
  maxPixels?: number
  /**
   * Se consulta ANTES de leer el cuerpo: si devuelve un texto, la subida se rechaza con 429 y ese texto
   * (p. ej. cola de OCR llena). Null/undefined = hay sitio.
   */
  checkCapacity?: () => string | null
  /** Se llama una vez si el servidor se apaga por caducidad (no por stop()). */
  onExpire?: () => void
  /** Solo para pruebas. */
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
}

/** `onImage` lanza esto para rechazar con un estado y un texto propios (p. ej. 429 si hay demasiadas fotos esperando OCR). */
export class UploadRejected extends Error {
  constructor(
    readonly status: 413 | 415 | 429 | 503,
    message: string
  ) {
    super(message)
    this.name = 'UploadRejected'
  }
}

export interface UploadServer {
  url: string
  token: string
  /** Epoch ms en que el servidor se apagará solo. */
  expiresAt: number
  stop(): Promise<void>
}

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024
const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_UPLOADS = 20
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** Cada subida en vuelo retiene hasta maxBytes en memoria. */
const MAX_IN_FLIGHT = 4
const DEFAULT_MAX_PIXELS = 40_000_000
/** Lado máximo aunque el área sea pequeña (una tira de 1 x 40 M de píxeles también agotaría memoria). */
const MAX_SIDE = 12_000
/** El móvil espera como mucho esto por la cabecera; el plazo total del cuerpo lo marca nuestro temporizador, no el de Node. */
const HEADERS_TIMEOUT_MS = 15_000
/** Margen de Node por encima de nuestro temporizador: así el 408 en español llega al móvil antes de que Node corte. */
const NODE_TIMEOUT_MARGIN_MS = 5_000

const NO_NETWORK = 'No se encontró una red local (wifi)'
const HEIC_MESSAGE = 'Formato HEIC no soportado: en el móvil elige JPG/Más compatible'
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'application/octet-stream'])
const TOO_BIG_PIXELS = 'La foto es demasiado grande (resolución). Reduce la calidad de la cámara.'
const BUSY = 'El ordenador está procesando otras fotos; espera un momento y vuelve a intentarlo.'
const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])

/** Comparación en tiempo constante: buffers de igual longitud (la longitud del token es pública: 32). */
export function tokenMatches(candidate: string, token: Buffer): boolean {
  const a = Buffer.from(candidate, 'utf8')
  if (a.length !== token.length) {
    timingSafeEqual(token, token)
    return false
  }
  return timingSafeEqual(a, token)
}

const firstHeader = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin'
} as const

function reply(res: ServerResponse, status: number, body = '', extra: Record<string, string> = {}, csp?: string): void {
  const buf = Buffer.from(body, 'utf8')
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Security-Policy': csp ?? "default-src 'none'; frame-ancestors 'none'",
    ...(body ? { 'Content-Type': 'text/plain; charset=utf-8' } : {}),
    'Content-Length': buf.length,
    ...extra
  })
  res.end(buf)
}

/** Responde y descarta (sin guardar) lo que siga llegando un rato, para que el cliente llegue a leer la respuesta. */
function rejectAndDrain(r: IncomingMessage, res: ServerResponse, status: number, message: string, grace = 1500): void {
  reply(res, status, message, { Connection: 'close' })
  r.on('data', () => undefined)
  const socket = r.socket
  const kill = setTimeout(() => socket.destroy(), grace)
  kill.unref()
  socket.once('close', () => clearTimeout(kill))
  res.once('finish', () => socket.end())
}

type Body = { kind: 'ok'; data: Buffer } | { kind: 'too-large' } | { kind: 'aborted' } | { kind: 'timeout' }

function readBody(r: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Body> {
  return new Promise((resolve) => {
    const parts: Buffer[] = []
    let size = 0
    let done = false
    const finish = (b: Body): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      r.off('data', onData)
      resolve(b)
    }
    const onData = (c: Buffer): void => {
      size += c.length
      if (size > maxBytes) return finish({ kind: 'too-large' })
      parts.push(c)
    }
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs)
    r.on('data', onData)
    r.on('end', () => finish({ kind: 'ok', data: Buffer.concat(parts) }))
    r.on('error', () => finish({ kind: 'aborted' }))
    r.on('close', () => finish({ kind: 'aborted' }))
  })
}

export async function startUploadServer(opts: UploadServerOptions): Promise<UploadServer> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const maxUploads = opts.maxUploads ?? DEFAULT_MAX_UPLOADS
  const timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const maxPixels = opts.maxPixels ?? DEFAULT_MAX_PIXELS
  const headersTimeoutMs = Math.min(HEADERS_TIMEOUT_MS, timeoutMs)

  // Nunca se escucha en todas las interfaces: o una IP concreta o error.
  const host = opts.host ?? pickLanAddress((opts.networkInterfaces ?? osNetworkInterfaces)())
  if (host === null || host === undefined) throw new Error(NO_NETWORK)
  if (['', '0', '0.0.0.0', '::', '[::]'].includes(host.trim())) throw new Error(`${NO_NETWORK}: host no válido`)

  const token = randomBytes(16).toString('hex')
  const tokenBuf = Buffer.from(token, 'utf8')
  const pagePath = `/u/${token}`
  const uploadPath = `${pagePath}/upload`
  let accepted = 0 // subidas completadas con éxito
  let inFlight = 0
  let announcedHost = '' // «ip:puerto» que se anuncia en la URL; se fija al empezar a escuchar

  /** 'page' | 'upload' si el token es válido; null para CUALQUIER otra cosa (mismo 404 vacío). */
  const route = (r: IncomingMessage): 'page' | 'upload' | null => {
    // Solo se atiende por la dirección anunciada: un Host distinto (DNS rebinding, proxy, navegador ajeno) no recibe nada.
    if ((r.headers.host ?? '').toLowerCase() !== announcedHost) return null
    // Un POST iniciado desde otra web (cross-site/same-site) nunca es del propio formulario del móvil.
    const fetchSite = r.headers['sec-fetch-site']
    if (r.method === 'POST' && fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return null
    const rawUrl = r.url
    const q = (rawUrl ?? '').indexOf('?')
    const path = q < 0 ? (rawUrl ?? '') : (rawUrl ?? '').slice(0, q)
    const seg = path.split('/')
    if (seg[0] !== '' || seg[1] !== 'u' || seg.length < 3 || seg.length > 4) return null
    if (!tokenMatches(seg[2] ?? '', tokenBuf)) return null
    if (seg.length === 3) return 'page'
    return seg[3] === 'upload' ? 'upload' : null
  }

  async function handleUpload(r: IncomingMessage, res: ServerResponse): Promise<void> {
    const type = (r.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (HEIC_TYPES.has(type)) return rejectAndDrain(r, res, 415, HEIC_MESSAGE)
    if (!ALLOWED_TYPES.has(type)) return rejectAndDrain(r, res, 415, 'Solo se admiten imágenes (PNG, JPG, WebP, GIF, BMP o TIFF).')
    const declared = r.headers['content-length']
    if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return rejectAndDrain(r, res, 413, 'La foto es demasiado grande.')
    const full = opts.checkCapacity?.()
    if (full) return rejectAndDrain(r, res, 429, full)
    if (inFlight >= MAX_IN_FLIGHT) return rejectAndDrain(r, res, 429, BUSY)
    if (accepted + inFlight >= maxUploads) return rejectAndDrain(r, res, 429, 'Demasiadas fotos enviadas en esta sesión.')

    inFlight++ // reserva el cupo mientras se recibe, para que subidas concurrentes no superen maxUploads
    try {
      const body = await readBody(r, maxBytes, timeoutMs)
      if (body.kind === 'aborted') return
      if (body.kind === 'timeout') return rejectAndDrain(r, res, 408, 'Se agotó el tiempo de espera. Inténtalo de nuevo.', 200)
      if (body.kind === 'too-large') return rejectAndDrain(r, res, 413, 'La foto es demasiado grande.')
      if (body.data.length === 0) return reply(res, 400, 'No se recibió ninguna foto.')
      const kind = detectImageType(body.data)
      if (kind === 'heic') return reply(res, 415, HEIC_MESSAGE)
      if (kind === null) return reply(res, 415, 'El archivo no es una imagen válida.')
      // Resolución declarada en la cabecera: se mira ANTES de que nada la decodifique. Sin tamaño legible no se pasa por OCR (415).
      const size = readImageSize(body.data)
      if (size === null) return reply(res, 415, 'No se pudo leer el tamaño de la imagen: el archivo no es una imagen válida.')
      if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > maxPixels) return reply(res, 413, TOO_BIG_PIXELS)
      try {
        await opts.onImage(body.data, sanitizeFilename(firstHeader(r.headers['x-filename'])))
      } catch (e) {
        if (e instanceof UploadRejected) return reply(res, e.status, e.message)
        return reply(res, 500, 'No se pudo procesar la foto en el ordenador. Inténtalo de nuevo.')
      }
      accepted++
      reply(res, 200, 'Foto recibida')
    } finally {
      inFlight--
    }
  }

  const server = createServer(
    {
      maxHeaderSize: 8192,
      headersTimeout: headersTimeoutMs,
      requestTimeout: timeoutMs + NODE_TIMEOUT_MARGIN_MS,
      connectionsCheckingInterval: Math.max(50, Math.min(1000, headersTimeoutMs / 2))
    },
    (r, res) => {
      const where = route(r)
      if (where === null) return reply(res, 404)
      if (where === 'page') {
        if (r.method !== 'GET') return reply(res, 405, '', { Allow: 'GET' })
        const nonce = randomBytes(16).toString('base64')
        const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
        return reply(res, 200, renderUploadPage({ uploadPath, nonce, maxBytes }), { 'Content-Type': 'text/html; charset=utf-8' }, csp)
      }
      if (r.method !== 'POST') return reply(res, 405, '', { Allow: 'POST' })
      void handleUpload(r, res).catch(() => {
        if (!res.headersSent) reply(res, 500, 'No se pudo procesar la foto en el ordenador. Inténtalo de nuevo.')
      })
    }
  )
  server.maxConnections = 16
  server.setTimeout(timeoutMs + NODE_TIMEOUT_MARGIN_MS) // conexiones inactivas
  server.on('clientError', (_e, socket: Socket) => socket.destroy())

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port: opts.port ?? 0, host, exclusive: true }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string' || addr.address === '0.0.0.0' || addr.address === '::') {
    server.close()
    throw new Error(NO_NETWORK)
  }

  announcedHost = `${addr.address}:${addr.port}`.toLowerCase()

  let closing: Promise<void> | null = null
  let timer: NodeJS.Timeout | undefined
  const stop = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      clearTimeout(timer)
      server.close(() => resolve())
      server.closeAllConnections()
    })
    return closing
  }
  const expiresAt = Date.now() + ttlMs
  timer = setTimeout(() => {
    if (closing) return
    void stop().then(() => opts.onExpire?.())
  }, ttlMs)
  timer.unref()

  return { url: `http://${addr.address}:${addr.port}${pagePath}`, token, expiresAt, stop }
}
