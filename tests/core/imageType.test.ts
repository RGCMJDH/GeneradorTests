import { describe, expect, it } from 'vitest'
import { detectImageType, readImageSize } from '@core/imageType'
import { bmp, gif, jpeg, png, tiff, webpExtended, webpLossless, webpLossy } from './imageBuilders'

describe('readImageSize', () => {
  it('PNG (IHDR)', () => expect(readImageSize(png(900, 160))).toEqual({ width: 900, height: 160 }))
  it('PNG con dimensiones enormes declaradas en un archivo diminuto', () => expect(readImageSize(png(20000, 20000))).toEqual({ width: 20000, height: 20000 }))
  it('JPEG baseline y progresivo, saltando APP0 y DHT antes del SOF', () => {
    expect(readImageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 })
    expect(readImageSize(jpeg(1000, 500, 0, 0xc2))).toEqual({ width: 1000, height: 500 })
  })
  it('JPEG sin SOF (truncado) -> null', () => expect(readImageSize(jpeg(10, 10).subarray(0, 18))).toBeNull())
  it('GIF (pantalla lógica)', () => expect(readImageSize(gif(640, 480))).toEqual({ width: 640, height: 480 }))
  it('GIF: toma el mayor entre la pantalla lógica y el descriptor del primer fotograma', () => {
    expect(readImageSize(gif(1, 1, 100, { frame: { w: 20000, h: 20000 } }))).toEqual({ width: 20000, height: 20000 })
    expect(readImageSize(gif(800, 600, 0, { frame: { w: 100, h: 700 } }))).toEqual({ width: 800, height: 700 })
  })
  it('GIF con tabla de colores global y extensiones antes del fotograma', () => {
    expect(readImageSize(gif(300, 200, 0, { extras: true }))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(gif(1, 1, 0, { extras: true, frame: { w: 65535, h: 65535 } }))).toEqual({ width: 65535, height: 65535 })
  })
  it('GIF sin descriptor de imagen (o truncado antes de él) -> null', () => {
    expect(readImageSize(gif(10, 10, 0, { noFrame: true }))).toBeNull()
    expect(readImageSize(gif(10, 10, 0, { extras: true }).subarray(0, 20))).toBeNull()
    expect(readImageSize(gif(10, 10).subarray(0, 18))).toBeNull() // descriptor cortado
  })
  it('GIF con una cadena interminable de extensiones -> null sin colgarse', () => {
    const ext = Buffer.from([0x21, 0xfe, 1, 0x41, 0])
    const many = Buffer.concat([gif(10, 10, 0, { noFrame: true }), ...Array.from({ length: 5000 }, () => ext)])
    expect(readImageSize(many)).toBeNull()
  })
  it('BMP: INFOHEADER, alto negativo y CORE header', () => {
    expect(readImageSize(bmp(300, 200))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(bmp(300, 200, { negativeHeight: true }))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(bmp(300, 200, { dib: 12 }))).toEqual({ width: 300, height: 200 })
    expect(readImageSize(bmp(300, 200, { dib: 124 }))).toEqual({ width: 300, height: 200 })
  })
  it('WebP lossy (VP8), lossless (VP8L) y extendido (VP8X)', () => {
    expect(readImageSize(webpLossy(800, 600))).toEqual({ width: 800, height: 600 })
    expect(readImageSize(webpLossless(1234, 4321))).toEqual({ width: 1234, height: 4321 })
    expect(readImageSize(webpExtended(16000, 9000))).toEqual({ width: 16000, height: 9000 })
  })
  it('TIFF little y big endian', () => {
    expect(readImageSize(tiff(700, 900))).toEqual({ width: 700, height: 900 })
    expect(readImageSize(tiff(700, 900, true))).toEqual({ width: 700, height: 900 })
  })
  it('cabeceras truncadas, vacías o con ceros -> null (nunca lanza)', () => {
    for (const b of [Buffer.alloc(0), Buffer.from([0x89, 0x50, 0x4e, 0x47]), png(5, 5).subarray(0, 20), gif(1, 1).subarray(0, 8), bmp(5, 5).subarray(0, 20), webpLossy(5, 5).subarray(0, 24), tiff(5, 5).subarray(0, 10), Buffer.from('texto')])
      expect(readImageSize(b)).toBeNull()
  })
  it('dimensiones cero -> null', () => {
    expect(readImageSize(png(0, 10))).toBeNull()
    expect(readImageSize(gif(10, 0))).toBeNull()
  })
  it('un IFD de TIFF que apunta fuera del buffer -> null', () => {
    const t = tiff(5, 5)
    t.writeUInt32LE(0xfffffff0, 4)
    expect(readImageSize(t)).toBeNull()
  })
})

describe('detectImageType: BMP estricto', () => {
  it('texto que empieza por «BM» no es un BMP', () => {
    expect(detectImageType(Buffer.from('BM es el principio de este texto plano, nada más'))).toBeNull()
    expect(detectImageType(Buffer.from('BM'))).toBeNull()
    expect(detectImageType(Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)]))).toBeNull() // DIB de tamaño 0
  })
  it('acepta los tamaños de cabecera DIB habituales', () => {
    for (const dib of [12, 40, 52, 56, 64, 108, 124]) expect(detectImageType(bmp(4, 4, { dib })), String(dib)).toBe('bmp')
    expect(detectImageType(bmp(4, 4, { dib: 41 }))).toBeNull()
  })
})
