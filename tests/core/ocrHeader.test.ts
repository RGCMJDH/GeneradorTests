import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertReadableImage } from '@core/ocr'
import { bmp, gif, jpeg, png, tiff, webpExtended, webpLossless, webpLossy } from './imageBuilders'

const dir = mkdtempSync(join(tmpdir(), 'gt-ocr-header-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const write = (name: string, data: Buffer | string): string => {
  const p = join(dir, name)
  writeFileSync(p, data)
  return p
}
const FOTO = readFileSync(fileURLToPath(new URL('../fixtures/foto-apuntes.png', import.meta.url)))

describe('assertReadableImage: lee cabecera suficiente para cada formato', () => {
  it('un BMP real (BITMAPFILEHEADER + DIB de 40 bytes + píxeles) pasa la comprobación', async () => {
    const pixels = Buffer.alloc(16, 0xff) // 2x2 a 24 bits con relleno de fila
    const file = Buffer.concat([bmp(2, 2), pixels])
    expect(file.readUInt32LE(14)).toBe(40)
    await expect(assertReadableImage(write('real.bmp', file))).resolves.toBeUndefined()
  })

  it('BMP con otras cabeceras DIB habituales (CORE 12, V4 108, V5 124)', async () => {
    for (const dib of [12, 108, 124]) await expect(assertReadableImage(write(`dib${dib}.bmp`, Buffer.concat([bmp(2, 2, { dib }), Buffer.alloc(16)])))).resolves.toBeUndefined()
  })

  it('PNG, JPEG, WebP (los tres tipos), GIF y TIFF siguen pasando', async () => {
    const files: Array<[string, Buffer]> = [
      ['a.png', FOTO],
      ['b.jpg', jpeg(10, 10, 64)],
      ['c.webp', webpLossy(10, 10, 64)],
      ['d.webp', webpLossless(10, 10, 64)],
      ['e.webp', webpExtended(10, 10, 64)],
      ['f.gif', gif(10, 10, 64)],
      ['g.tif', tiff(10, 10)],
      ['h.png', png(4, 4)]
    ]
    for (const [name, data] of files) await expect(assertReadableImage(write(name, data)), name).resolves.toBeUndefined()
  })

  it('HEIC se rechaza con su mensaje; texto o un archivo diminuto, como «no es una imagen»', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)])
    await expect(assertReadableImage(write('x.heic', heic))).rejects.toThrow(/HEIC/)
    await expect(assertReadableImage(write('t.png', 'BM esto es texto, no una imagen, aunque empiece por BM'))).rejects.toThrow(/no es una imagen válida/)
    await expect(assertReadableImage(write('tiny.bmp', 'BM'))).rejects.toThrow(/no es una imagen válida/)
    await expect(assertReadableImage(join(dir, 'no-existe.png'))).rejects.toThrow(/no existe/)
  })
})
