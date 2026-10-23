import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { request, type IncomingHttpHeaders } from 'node:http'
import { connect } from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectImageType } from '@core/imageType'
import { pickLanAddress, sanitizeFilename, startUploadServer, tokenMatches } from '@core/mobile'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FOTO = readFileSync(join(ROOT, 'tests/fixtures/foto-apuntes.png'))
const HEIC_MESSAGE = 'Formato HEIC no soportado: en el móvil elige JPG/Más compatible'

type Server = Awaited<ReturnType<typeof startUploadServer>>
type OnImage = (data: Buffer, filename: string) => Promise<void>

const started: Server[] = []
afterEach(async () => {
  await Promise.all(started.splice(0).map((s) => s.stop()))
})

async function start(over: Partial<Parameters<typeof startUploadServer>[0]> = {}, onImage?: OnImage) {
  const spy = vi.fn<OnImage>(onImage ?? (async () => undefined))
  const server = await startUploadServer({ onImage: spy, host: '127.0.0.1', port: 0, ...over })
  started.push(server)
  const u = new URL(server.url)
  return { server, spy, origin: u.origin, base: u.pathname, port: Number(u.port) }
}

interface Reply {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  text: string
}

function send(origin: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(origin)
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body)
    const headers: Record<string, string | number> = { ...opts.headers }
    if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')) headers['Content-Length'] = body.length
    const r = request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers, agent: false }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (c: Buffer) => parts.push(c))
      res.on('end', () => {
        const b = Buffer.concat(parts)
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b, text: b.toString('utf8') })
      })
      res.on('error', reject)
    })
    r.on('error', reject)
    r.end(body)
  })
}

const upload = (s: { origin: string; base: string }, body: Buffer | string, type = 'image/png', extra: Record<string, string> = {}) =>
  send(s.origin, `${s.base}/upload`, { method: 'POST', headers: { 'Content-Type': type, ...extra }, body })

/** Resuelve con el estado HTTP, o con 'closed' si el servidor cortó la conexión sin responder. */
function rawExchange(port: number, payload: string, waitMs = 3000): Promise<{ closed: boolean; data: string }> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1')
    let data = ''
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ closed: false, data })
    }, waitMs)
    sock.on('connect', () => sock.write(payload))
    sock.on('data', (c) => (data += c.toString('latin1')))
    sock.on('error', () => undefined)
    sock.on('close', () => {
      clearTimeout(timer)
      resolve({ closed: true, data })
    })
  })
}

const portOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = connect(port, '127.0.0.1')
    s.on('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.on('error', () => resolve(false))
  })

const lan = (address: string, internal = false): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` }) as NetworkInterfaceInfo

// ---------------------------------------------------------------- token y rutas

describe('token y rutas (sin oráculo)', () => {
  it('el token tiene 32 hex (128 bits) y es distinto en cada servidor', async () => {
    const a = await start()
    const b = await start()
    expect(a.server.token).toMatch(/^[0-9a-f]{32}$/)
    expect(b.server.token).toMatch(/^[0-9a-f]{32}$/)
    expect(a.server.token).not.toBe(b.server.token)
    expect(a.server.url).toBe(`http://127.0.0.1:${a.port}/u/${a.server.token}`)
  })

  it('POST con el token correcto llama a onImage con los bytes exactos', async () => {
    const s = await start()
    const r = await upload(s, FOTO, 'image/png', { 'X-Filename': 'apuntes.png' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('Foto recibida')
    expect(s.spy).toHaveBeenCalledTimes(1)
    const [data, filename] = s.spy.mock.calls[0]!
    expect(Buffer.compare(data, FOTO)).toBe(0)
    expect(filename).toBe('apuntes.png')
  })

  it('token incorrecto, ausente o ruta incorrecta: 404 con cuerpo vacío y onImage no se llama', async () => {
    const s = await start()
    const wrong = 'a'.repeat(32)
    const paths = [
      `/u/${wrong}/upload`,
      `/u/${wrong.slice(0, 31)}/upload`,
      `/u/${s.server.token}0/upload`,
      '/u//upload',
      '/u/upload',
      '/upload',
      '/',
      '/favicon.ico',
      `/u/${s.server.token}/otra`,
      `/u/${s.server.token}/upload/`,
      `/u/${s.server.token}/upload/extra`,
      `/u/${s.server.token}/../upload`,
      `/${s.server.token}/upload`,
      `/U/${s.server.token}/upload`
    ]
    for (const p of paths) {
      const r = await send(s.origin, p, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: FOTO })
      expect(r.status, p).toBe(404)
      expect(r.body.length, p).toBe(0)
    }
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('las respuestas 404 son indistinguibles (mismo estado, cabeceras y cuerpo) sea cual sea el fallo', async () => {
    const s = await start()
    const a = await send(s.origin, `/u/${'b'.repeat(32)}`)
    const b = await send(s.origin, '/nada')
    const c = await send(s.origin, `/u/${'c'.repeat(32)}/upload`, { method: 'POST', body: 'x' })
    for (const r of [b, c]) {
      expect(r.status).toBe(a.status)
      expect(r.text).toBe(a.text)
      expect({ ...r.headers, date: '' }).toEqual({ ...a.headers, date: '' })
    }
    expect(a.headers['content-security-policy']).toBeDefined()
    expect(a.headers['x-content-type-options']).toBe('nosniff')
  })

  it('el token se compara con timingSafeEqual sobre buffers de igual longitud', () => {
    const token = Buffer.from('0123456789abcdef0123456789abcdef')
    expect(tokenMatches('0123456789abcdef0123456789abcdef', token)).toBe(true)
    expect(tokenMatches('0123456789abcdef0123456789abcdee', token)).toBe(false)
    expect(tokenMatches('0123456789abcdef', token)).toBe(false)
    expect(tokenMatches('', token)).toBe(false)
    const src = readFileSync(join(ROOT, 'src/core/mobile.ts'), 'utf8')
    expect(src).toContain('timingSafeEqual')
    expect(src).not.toMatch(/token\s*={2,3}|={2,3}\s*(this\.)?token/)
  })

  it('el token es secreto aleatorio de crypto.randomBytes(16)', () => {
    const src = readFileSync(join(ROOT, 'src/core/mobile.ts'), 'utf8')
    expect(src).toContain('randomBytes(16)')
  })
})

// ---------------------------------------------------------------- página

describe('página de subida', () => {
  it('GET con token devuelve HTML con CSP por nonce, nosniff y sin CORS', async () => {
    const s = await start()
    const r = await send(s.origin, s.base)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/^text\/html/)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control-'))).toEqual([])
    const csp = String(r.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    const nonce = /script-src 'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain(`style-src 'nonce-${nonce}'`)
    expect(r.text).toContain(`<script nonce="${nonce}">`)
    expect(r.text).toContain(`<style nonce="${nonce}">`)
    expect(r.text).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*capture="environment"|<input[^>]*accept="image\/\*"[^>]*capture="environment"[^>]*type="file"/)
    expect(r.text).toContain(`/u/${s.server.token}/upload`)
    expect(r.text).not.toMatch(/\son\w+=/i) // sin manejadores inline
  })

  it('el nonce cambia en cada respuesta', async () => {
    const s = await start()
    const n = async () => /nonce-([^']+)'/.exec(String((await send(s.origin, s.base)).headers['content-security-policy']))?.[1]
    const [a, b, c] = [await n(), await n(), await n()]
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('la página no se sirve con token incorrecto', async () => {
    const s = await start()
    const r = await send(s.origin, `/u/${'0'.repeat(32)}`)
    expect(r.status).toBe(404)
    expect(r.body.length).toBe(0)
  })
})

// ---------------------------------------------------------------- validación del archivo

describe('validación del archivo recibido', () => {
  it('Content-Type que no es imagen permitida: 415 y onImage no se llama', async () => {
    const s = await start()
    for (const type of ['text/plain', 'application/json', 'text/html', 'image/svg+xml', 'application/pdf', 'multipart/form-data; boundary=x', '']) {
      const r = await upload(s, FOTO, type)
      expect(r.status, type).toBe(415)
    }
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('acepta image/png|jpeg|webp|gif|bmp|tiff y application/octet-stream si los bytes son de imagen', async () => {
    const s = await start()
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'application/octet-stream', 'IMAGE/PNG; charset=binary']) {
      expect((await upload(s, FOTO, type)).status, type).toBe(200)
    }
  })

  it('dice image/png pero los bytes son texto: 415 por la firma (magic bytes)', async () => {
    const s = await start()
    const r = await upload(s, 'esto no es un png, es texto plano <script>', 'image/png')
    expect(r.status).toBe(415)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('un ejecutable o un PDF disfrazados de image/jpeg se rechazan', async () => {
    const s = await start()
    expect((await upload(s, Buffer.from('MZ\x90\x00\x03\x00\x00\x00 payload payload'), 'image/jpeg')).status).toBe(415)
    expect((await upload(s, Buffer.from('%PDF-1.7 payload payload payload'), 'image/jpeg')).status).toBe(415)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('HEIC (por Content-Type o por firma): 415 con el mensaje en español', async () => {
    const s = await start()
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)])
    for (const [body, type] of [
      [heic, 'image/heic'],
      [heic, 'image/heif'],
      [heic, 'image/jpeg'],
      [heic, 'application/octet-stream'],
      [FOTO, 'image/heic']
    ] as const) {
      const r = await upload(s, body, type)
      expect(r.status, type).toBe(415)
      expect(r.text).toBe(HEIC_MESSAGE)
    }
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('cuerpo vacío: 400', async () => {
    const s = await start()
    expect((await upload(s, Buffer.alloc(0))).status).toBe(400)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('detectImageType reconoce las seis firmas y HEIC', () => {
    const pad = Buffer.alloc(16)
    expect(detectImageType(FOTO)).toBe('png')
    expect(detectImageType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad]))).toBe('jpeg')
    expect(detectImageType(Buffer.concat([Buffer.from('GIF89a'), pad]))).toBe('gif')
    expect(detectImageType(Buffer.concat([Buffer.from('BM'), pad]))).toBe('bmp')
    expect(detectImageType(Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), pad]))).toBe('tiff')
    expect(detectImageType(Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), pad]))).toBe('tiff')
    expect(detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad]))).toBe('webp')
    expect(detectImageType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmif1'), pad]))).toBe('heic')
    expect(detectImageType(Buffer.from('hola'))).toBeNull()
    expect(detectImageType(Buffer.alloc(0))).toBeNull()
    expect(detectImageType(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})

// ---------------------------------------------------------------- límites

describe('límites', () => {
  it('más de maxBytes en streaming (chunked, sin Content-Length): 413 y onImage no se llama', async () => {
    const s = await start({ maxBytes: 1000 })
    const status = await new Promise<number | string>((resolve) => {
      const u = new URL(s.origin)
      const r = request(
        { host: u.hostname, port: u.port, path: `${s.base}/upload`, method: 'POST', headers: { 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' }, agent: false },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      r.on('error', (e) => resolve(`error:${(e as NodeJS.ErrnoException).code}`))
      const png = FOTO.subarray(0, 300)
      let n = 0
      const tick = setInterval(() => {
        if (++n > 20 || r.destroyed) {
          clearInterval(tick)
          r.end()
        } else r.write(png)
      }, 5)
    })
    expect(status).toBe(413)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('Content-Length mayor que maxBytes (aunque no se envíe el cuerpo): 413 inmediato', async () => {
    const s = await start({ maxBytes: 1000 })
    const raw = await rawExchange(
      s.port,
      `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: 999999999\r\n\r\n`
    )
    expect(raw.data).toMatch(/^HTTP\/1\.1 413 /)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('Content-Length mentiroso (menor que lo enviado): nunca se entrega más de lo declarado ni más de maxBytes', async () => {
    const s = await start({ maxBytes: 1000 })
    const body = FOTO.subarray(0, 600)
    const smuggled = Buffer.alloc(3000, 0x41)
    const payload = Buffer.concat([
      Buffer.from(`POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: ${body.length}\r\n\r\n`),
      body,
      smuggled
    ])
    await rawExchange(s.port, payload.toString('latin1'), 500)
    for (const [data] of s.spy.mock.calls) expect(data.length).toBeLessThanOrEqual(body.length)
  })

  it('un archivo de exactamente maxBytes se acepta', async () => {
    const png = Buffer.concat([FOTO.subarray(0, 8), Buffer.alloc(992)])
    const s = await start({ maxBytes: 1000 })
    expect(png.length).toBe(1000)
    expect((await upload(s, png)).status).toBe(200)
    expect((await upload(s, Buffer.concat([png, Buffer.from([0])]))).status).toBe(413)
  })

  it('por defecto el límite es 15 MB', async () => {
    const s = await start()
    const raw = await rawExchange(
      s.port,
      `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: ${15 * 1024 * 1024 + 1}\r\n\r\n`
    )
    expect(raw.data).toMatch(/^HTTP\/1\.1 413 /)
  })

  it('solo POST en la ruta de subida (405) y OPTIONS no concede CORS', async () => {
    const s = await start()
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const r = await send(s.origin, `${s.base}/upload`, { method })
      expect(r.status, method).toBe(405)
      expect(r.headers['allow']).toBe('POST')
    }
    const pre = await send(s.origin, `${s.base}/upload`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
    })
    expect(pre.status).toBeGreaterThanOrEqual(400)
    expect(Object.keys(pre.headers).filter((h) => h.startsWith('access-control-'))).toEqual([])
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('POST en la ruta de la página (sin /upload) no sube nada: 405', async () => {
    const s = await start()
    expect((await send(s.origin, s.base, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: FOTO })).status).toBe(405)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('maxUploads: tras N subidas aceptadas responde 429', async () => {
    const s = await start({ maxUploads: 2 })
    expect((await upload(s, FOTO)).status).toBe(200)
    expect((await upload(s, FOTO)).status).toBe(200)
    expect((await upload(s, FOTO)).status).toBe(429)
    expect(s.spy).toHaveBeenCalledTimes(2)
  })

  it('maxUploads por defecto: 20', async () => {
    const s = await start()
    for (let i = 0; i < 20; i++) expect((await upload(s, FOTO)).status).toBe(200)
    expect((await upload(s, FOTO)).status).toBe(429)
  }, 30000)

  it('maxUploads con subidas concurrentes: nunca se aceptan más de las permitidas', async () => {
    const s = await start({ maxUploads: 2 }, () => new Promise((r) => setTimeout(r, 50)))
    const rs = await Promise.all([1, 2, 3].map(() => upload(s, FOTO)))
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 429])
    expect(s.spy).toHaveBeenCalledTimes(2)
  })

  it('una subida rechazada (415/413) no consume cupo', async () => {
    const s = await start({ maxUploads: 1 })
    expect((await upload(s, 'texto', 'image/png')).status).toBe(415)
    expect((await upload(s, FOTO)).status).toBe(200)
  })

  it('dos subidas concurrentes se atienden con sus propios bytes', async () => {
    const other = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)])
    const s = await start({}, () => new Promise((r) => setTimeout(r, 30)))
    const [a, b] = await Promise.all([upload(s, FOTO, 'image/png', { 'X-Filename': 'a.png' }), upload(s, other, 'image/jpeg', { 'X-Filename': 'b.jpg' })])
    expect([a.status, b.status]).toEqual([200, 200])
    const got = new Map(s.spy.mock.calls.map(([d, f]) => [f, d]))
    expect(Buffer.compare(got.get('a.png')!, FOTO)).toBe(0)
    expect(Buffer.compare(got.get('b.jpg')!, other)).toBe(0)
  })
})

// ---------------------------------------------------------------- errores y nombre de archivo

describe('errores y nombre de archivo', () => {
  it('si onImage falla: 500 genérico en español, sin pila, rutas ni mensaje original', async () => {
    const s = await start({}, async () => {
      throw new Error('ENOENT: C:\\Users\\ramon\\secreto\\x.png at Object.<anonymous> (C:\\app\\main.ts:10:5)')
    })
    const r = await upload(s, FOTO)
    expect(r.status).toBe(500)
    expect(r.text).toMatch(/No se pudo procesar la foto/)
    expect(r.text).not.toMatch(/ENOENT|C:\\|\.ts|at Object|secreto/)
  })

  it('el nombre del archivo nunca llega con separadores de ruta ni caracteres de control', async () => {
    const s = await start()
    const names = ['..%2F..%2Fevil.png', '..\\..\\windows\\system32\\evil.png', '%2Fetc%2Fpasswd', 'a%00b.png', '%E0%A4%A', 'foto%0D%0AX-Inject:1.png', '']
    for (const n of names) {
      expect((await upload(s, FOTO, 'image/png', n ? { 'X-Filename': n } : {})).status, n).toBe(200)
    }
    for (const [, filename] of s.spy.mock.calls) {
      expect(filename).not.toMatch(/[\\/\u0000-\u001f]/)
      expect(filename).not.toContain('..')
      expect(filename.length).toBeGreaterThan(0)
      expect(filename.length).toBeLessThanOrEqual(100)
    }
    expect(s.spy.mock.calls[0]![1]).toBe('evil.png')
    expect(s.spy.mock.calls[6]![1]).toBe('foto')
  })

  it('sanitizeFilename', () => {
    expect(sanitizeFilename('IMG 001.jpg')).toBe('IMG 001.jpg')
    expect(sanitizeFilename(encodeURIComponent('Apuntes de química ñ.png'))).toBe('Apuntes de química ñ.png')
    expect(sanitizeFilename('a'.repeat(300) + '.png').length).toBe(100)
    expect(sanitizeFilename('.hidden')).toBe('hidden')
    expect(sanitizeFilename('CON:*?<>|"')).not.toMatch(/[:*?<>|"]/)
    expect(sanitizeFilename(undefined)).toBe('foto')
  })

  it('el servidor no usa el nombre como ruta: no importa node:fs ni node:path', () => {
    const src = readFileSync(join(ROOT, 'src/core/mobile.ts'), 'utf8')
    expect(src).not.toMatch(/from 'node:(fs|path)(\/promises)?'/)
    expect(src).not.toMatch(/from 'electron'/)
  })
})

// ---------------------------------------------------------------- red

describe('dirección de escucha', () => {
  it('pickLanAddress: primera IPv4 no interna; ignora loopback, IPv6 y enlace local', () => {
    expect(
      pickLanAddress({
        Loopback: [lan('127.0.0.1', true)],
        'Wi-Fi': [{ ...lan('fe80::1'), family: 'IPv6' } as NetworkInterfaceInfo, lan('169.254.3.4'), lan('192.168.1.40')]
      })
    ).toBe('192.168.1.40')
    expect(pickLanAddress({ lo: [lan('127.0.0.1', true)] })).toBeNull()
    expect(pickLanAddress({})).toBeNull()
    expect(pickLanAddress({ eth: undefined })).toBeNull()
  })

  it('pickLanAddress prefiere redes privadas y relega los adaptadores virtuales', () => {
    expect(
      pickLanAddress({
        'vEthernet (WSL)': [lan('172.28.0.1')],
        VirtualBox: [lan('192.168.56.1')],
        'Wi-Fi': [lan('192.168.1.40')]
      })
    ).toBe('192.168.1.40')
    expect(pickLanAddress({ Pub: [lan('83.12.1.5')], Wi: [lan('10.0.0.7')] })).toBe('10.0.0.7')
    // si solo hay virtuales, se usa uno
    expect(pickLanAddress({ VirtualBox: [lan('192.168.56.1')] })).toBe('192.168.56.1')
  })

  it('sin red local: error en español y no se abre ningún puerto (nunca 0.0.0.0)', async () => {
    const listen = vi.spyOn((await import('node:http')).Server.prototype, 'listen')
    await expect(startUploadServer({ onImage: async () => undefined, networkInterfaces: () => ({ lo: [lan('127.0.0.1', true)] }) })).rejects.toThrow('No se encontró una red local (wifi)')
    expect(listen).not.toHaveBeenCalled()
    listen.mockRestore()
  })

  it('escucha en la IP elegida (no en 0.0.0.0 ni en ::) cuando no se pasa host', async () => {
    const server = await startUploadServer({ onImage: async () => undefined, port: 0, networkInterfaces: () => ({ 'Wi-Fi': [lan('127.0.0.1')] }) })
    started.push(server)
    expect(new URL(server.url).hostname).toBe('127.0.0.1')
  })

  it('rechaza hosts comodín explícitos', async () => {
    for (const host of ['0.0.0.0', '::', '', '0']) {
      await expect(startUploadServer({ onImage: async () => undefined, host, port: 0 }), host).rejects.toThrow(/wifi|host/i)
    }
  })

  it('el código fuente no enlaza nunca a 0.0.0.0', () => {
    const src = readFileSync(join(ROOT, 'src/core/mobile.ts'), 'utf8')
    expect(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/listen\([^)]*(0\.0\.0\.0|'::')/)
  })
})

// ---------------------------------------------------------------- ciclo de vida

describe('ciclo de vida', () => {
  it('stop() cierra el puerto y es idempotente', async () => {
    const s = await start()
    expect(await portOpen(s.port)).toBe(true)
    await s.server.stop()
    expect(await portOpen(s.port)).toBe(false)
    await expect(s.server.stop()).resolves.toBeUndefined()
    await expect(Promise.all([s.server.stop(), s.server.stop()])).resolves.toBeDefined()
  })

  it('stop() corta también las conexiones abiertas', async () => {
    const s = await start()
    const hang = rawExchange(s.port, `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: 100\r\n\r\nabc`, 5000)
    await new Promise((r) => setTimeout(r, 100))
    await s.server.stop()
    expect((await hang).closed).toBe(true)
  })

  it('tras stop() una subida en curso no llega a onImage', async () => {
    const s = await start()
    const hang = rawExchange(s.port, `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: ${FOTO.length}\r\n\r\n`, 3000)
    await new Promise((r) => setTimeout(r, 100))
    await s.server.stop()
    await hang
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('el servidor se apaga solo al vencer ttlMs y avisa con onExpire (no con stop())', async () => {
    const onExpire = vi.fn()
    const s = await start({ ttlMs: 150, onExpire })
    expect(await portOpen(s.port)).toBe(true)
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledTimes(1), { timeout: 3000 })
    await vi.waitFor(async () => expect(await portOpen(s.port)).toBe(false), { timeout: 3000 })
    await s.server.stop() // idempotente tras la expiración
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('stop() manual cancela el temporizador: onExpire no se llama', async () => {
    const onExpire = vi.fn()
    const s = await start({ ttlMs: 150, onExpire })
    await s.server.stop()
    await new Promise((r) => setTimeout(r, 300))
    expect(onExpire).not.toHaveBeenCalled()
  })

  it('por defecto caduca a los 10 minutos y expiresAt lo refleja', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const before = Date.now()
      const server = await startUploadServer({ onImage: async () => undefined, host: '127.0.0.1', port: 0 })
      started.push(server)
      expect(server.expiresAt - before).toBe(10 * 60 * 1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cuerpo lento (se queda a medias): se corta por tiempo y onImage no se llama', async () => {
    const s = await start({ requestTimeoutMs: 300 })
    const t0 = Date.now()
    const raw = await rawExchange(s.port, `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: 5000\r\n\r\n${'A'.repeat(50)}`, 4000)
    expect(raw.closed).toBe(true)
    expect(Date.now() - t0).toBeLessThan(3500)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('goteo lento (un byte cada poco, nunca inactivo): el plazo total lo corta igualmente', async () => {
    const s = await start({ requestTimeoutMs: 400 })
    const closed = await new Promise<boolean>((resolve) => {
      const sock = connect(s.port, '127.0.0.1')
      sock.on('connect', () => {
        sock.write(`POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/png\r\nContent-Length: 5000\r\n\r\n`)
        const drip = setInterval(() => {
          if (!sock.destroyed) sock.write('A')
        }, 60)
        sock.on('close', () => {
          clearInterval(drip)
          resolve(true)
        })
      })
      sock.on('error', () => undefined)
      setTimeout(() => {
        sock.destroy()
        resolve(false)
      }, 4000)
    })
    expect(closed).toBe(true)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('cabeceras incompletas (slowloris): la conexión se cierra por tiempo', async () => {
    const s = await start({ requestTimeoutMs: 300 })
    const t0 = Date.now()
    const raw = await rawExchange(s.port, `POST ${s.base}/upload HTTP/1.1\r\nHost: x\r\nContent-Ty`, 4000)
    expect(raw.closed).toBe(true)
    expect(Date.now() - t0).toBeLessThan(3500)
  })
})
