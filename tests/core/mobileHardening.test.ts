import { afterEach, describe, expect, it } from 'vitest'
import { UploadRejected } from '@core/mobile'
import { bmp, gif, jpeg, png, webpLossless } from './imageBuilders'
import { rawExchange, send, start, stopAll, upload } from './mobileHarness'

afterEach(stopAll)

const BIG_MESSAGE = 'La foto es demasiado grande (resolución). Reduce la calidad de la cámara.'
const BUSY_MESSAGE = 'El ordenador está procesando otras fotos; espera un momento y vuelve a intentarlo.'

describe('tamaño en píxeles (antes de llegar a onImage / al OCR)', () => {
  it('un PNG diminuto que declara 20000x20000 se rechaza con 413 y el mensaje en español', async () => {
    const s = await start()
    const bytes = png(20000, 20000, 600)
    expect(bytes.length).toBeLessThan(1000)
    const r = await upload(s, bytes)
    expect(r.status).toBe(413)
    expect(r.text).toBe(BIG_MESSAGE)
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('lo mismo en JPEG, GIF, BMP y WebP', async () => {
    const s = await start()
    for (const [body, type] of [
      [jpeg(9000, 9000, 300), 'image/jpeg'],
      [gif(30000, 30000, 100), 'image/gif'],
      [bmp(9000, 9000, { total: 100 }), 'image/bmp'],
      [webpLossless(9000, 9000, 100), 'image/webp']
    ] as const) {
      const r = await upload(s, body, type)
      expect(r.status, type).toBe(413)
      expect(r.text).toBe(BIG_MESSAGE)
    }
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('cada lado se limita a 12000 aunque el área sea pequeña', async () => {
    const s = await start()
    expect((await upload(s, png(12001, 10))).status).toBe(413)
    expect((await upload(s, png(10, 12001))).status).toBe(413)
    expect((await upload(s, png(12000, 10))).status).toBe(200)
  })

  it('por defecto el tope es de 40 millones de píxeles (el límite exacto se acepta)', async () => {
    const s = await start()
    expect((await upload(s, png(8000, 5000))).status).toBe(200)
    expect((await upload(s, png(8001, 5000))).status).toBe(413)
  })

  it('maxPixels es configurable', async () => {
    const s = await start({ maxPixels: 100 })
    expect((await upload(s, png(10, 10))).status).toBe(200)
    expect((await upload(s, png(11, 10))).status).toBe(413)
  })

  it('si no se puede leer el tamaño se rechaza con 415 (decisión: sin tamaño verificable no se pasa por OCR)', async () => {
    const s = await start()
    const r = await upload(s, Buffer.concat([png(10, 10).subarray(0, 8), Buffer.alloc(200)])) // firma PNG válida, sin IHDR
    expect(r.status).toBe(415)
    expect(r.text).toMatch(/tamaño/)
    expect((await upload(s, jpeg(10, 10).subarray(0, 12), 'image/jpeg')).status).toBe(415)
    expect(s.spy).not.toHaveBeenCalled()
  })
})

describe('Host y Sec-Fetch-Site', () => {
  it('un Host que no es exactamente ip:puerto da el mismo 404 vacío (GET y POST, con token correcto)', async () => {
    const s = await start()
    const miss = await send(s.origin, '/nada')
    for (const host of ['evil.example', '127.0.0.1', `127.0.0.1:${s.port + 1}`, `localhost:${s.port}`, '192.168.1.40:80', `${s.host}.evil.example`]) {
      const g = await send(s.origin, s.base, { headers: { Host: host } })
      expect(g.status, `GET ${host}`).toBe(404)
      expect(g.body.length).toBe(0)
      const p = await upload(s, png(10, 10), 'image/png', { Host: host })
      expect(p.status, `POST ${host}`).toBe(404)
      expect(p.body.length).toBe(0)
      expect({ ...p.headers, date: '' }).toEqual({ ...miss.headers, date: '' })
    }
    expect(s.spy).not.toHaveBeenCalled()
  })

  it('sin cabecera Host (HTTP/1.0) también es 404', async () => {
    const s = await start()
    const raw = await rawExchange(s.port, `GET ${s.base} HTTP/1.0\r\n\r\n`)
    expect(raw.data).toMatch(/^HTTP\/1\.[01] 404 /)
  })

  it('el Host correcto se acepta sin importar mayúsculas', async () => {
    const s = await start()
    expect((await send(s.origin, s.base, { headers: { Host: s.host.toUpperCase() } })).status).toBe(200)
    expect((await upload(s, png(10, 10), 'image/png', { Host: s.host })).status).toBe(200)
  })

  it('un POST con Sec-Fetch-Site distinto de same-origin/none es 404 y no sube nada', async () => {
    const s = await start()
    for (const v of ['cross-site', 'same-site', 'CROSS-SITE', 'x']) {
      const r = await upload(s, png(10, 10), 'image/png', { 'Sec-Fetch-Site': v })
      expect(r.status, v).toBe(404)
      expect(r.body.length).toBe(0)
    }
    expect(s.spy).not.toHaveBeenCalled()
    for (const v of ['same-origin', 'none']) expect((await upload(s, png(10, 10), 'image/png', { 'Sec-Fetch-Site': v })).status, v).toBe(200)
    expect((await upload(s, png(10, 10))).status).toBe(200) // navegadores sin la cabecera
  })

  it('la página se abre con Sec-Fetch-Site: none (escanear el QR es una navegación directa)', async () => {
    const s = await start()
    expect((await send(s.origin, s.base, { headers: { 'Sec-Fetch-Site': 'none' } })).status).toBe(200)
  })
})

describe('cupo en vuelo y mensajes', () => {
  it('con 4 subidas en curso la quinta recibe 429 con el texto de «ocupado», no el del cupo agotado', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const s = await start({}, () => gate)
    const first = [1, 2, 3, 4].map(() => upload(s, png(10, 10)))
    await new Promise((r) => setTimeout(r, 200))
    const fifth = await upload(s, png(10, 10))
    expect(fifth.status).toBe(429)
    expect(fifth.text).toBe(BUSY_MESSAGE)
    release()
    expect((await Promise.all(first)).map((r) => r.status)).toEqual([200, 200, 200, 200])
  })

  it('el cupo de la sesión agotado conserva su propio texto', async () => {
    const s = await start({ maxUploads: 1 })
    await upload(s, png(10, 10))
    const r = await upload(s, png(10, 10))
    expect(r.status).toBe(429)
    expect(r.text).toBe('Demasiadas fotos enviadas en esta sesión.')
  })

  it('onImage puede rechazar con UploadRejected: el móvil recibe ese estado y ese texto (sin consumir cupo)', async () => {
    let busy = true
    const s = await start({ maxUploads: 1 }, async () => {
      if (busy) throw new UploadRejected(429, 'Espera a que se procesen las fotos anteriores')
    })
    const r = await upload(s, png(10, 10))
    expect(r.status).toBe(429)
    expect(r.text).toBe('Espera a que se procesen las fotos anteriores')
    busy = false
    expect((await upload(s, png(10, 10))).status).toBe(200)
  })

  it('checkCapacity rechaza antes de leer el cuerpo', async () => {
    let msg: string | null = 'Espera a que se procesen las fotos anteriores'
    const s = await start({ checkCapacity: () => msg })
    const raw = await rawExchange(s.port, `POST ${s.base}/upload HTTP/1.1\r\nHost: ${s.host}\r\nContent-Type: image/png\r\nContent-Length: 2000\r\n\r\n`)
    expect(raw.data).toMatch(/^HTTP\/1\.1 429 /)
    expect(raw.data).toContain('Espera a que se procesen las fotos anteriores')
    expect(s.spy).not.toHaveBeenCalled()
    msg = null
    expect((await upload(s, png(10, 10))).status).toBe(200)
  })
})

describe('aviso de conexión sin cifrar', () => {
  it('la página del móvil advierte de que la foto viaja sin cifrar', async () => {
    const s = await start()
    const page = await send(s.origin, s.base)
    expect(page.text).toContain('sin cifrar')
    expect(page.text).toContain('redes wifi de confianza')
  })
})
