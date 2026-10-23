// Cabeceras sintéticas mínimas de cada formato: lo justo para que la firma y el tamaño se lean (no son imágenes decodificables).
const u16be = (n: number): Buffer => Buffer.from([(n >> 8) & 0xff, n & 0xff])
const u16le = (n: number): Buffer => Buffer.from([n & 0xff, (n >> 8) & 0xff])
const u32be = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}
const pad = (head: Buffer, total: number): Buffer => (total > head.length ? Buffer.concat([head, Buffer.alloc(total - head.length)]) : head)

export const png = (w: number, h: number, total = 0): Buffer =>
  pad(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32be(13), Buffer.from('IHDR'), u32be(w), u32be(h), Buffer.from([8, 6, 0, 0, 0]), u32be(0)]),
    total
  )

/** Con un segmento APP0 antes del SOF (como las fotos reales con EXIF). `sof` = 0xC0 (baseline), 0xC2 (progresivo)... */
export const jpeg = (w: number, h: number, total = 0, sof = 0xc0): Buffer =>
  pad(
    Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 1, 2, 3, 4]),
      Buffer.from([0xff, 0xc4, 0x00, 0x04, 9, 9]), // DHT: no es un SOF, hay que saltarlo
      Buffer.from([0xff, sof, 0x00, 0x0b, 8]),
      u16be(h),
      u16be(w),
      Buffer.from([1, 0x11, 0])
    ]),
    total
  )

export const gif = (w: number, h: number, total = 0): Buffer => pad(Buffer.concat([Buffer.from('GIF89a'), u16le(w), u16le(h), Buffer.from([0, 0, 0])]), total)

/** BMP con BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40); `dib` 12 = BITMAPCOREHEADER (u16). Alto negativo = fila superior primero. */
export const bmp = (w: number, h: number, opts: { dib?: number; negativeHeight?: boolean; total?: number } = {}): Buffer => {
  const dib = opts.dib ?? 40
  const file = Buffer.concat([Buffer.from('BM'), u32le(0), u32le(0), u32le(14 + dib)])
  const info = dib === 12 ? Buffer.concat([u32le(12), u16le(w), u16le(h), u16le(1), u16le(24)]) : Buffer.concat([u32le(dib), u32le(w), u32le(opts.negativeHeight ? -h : h), u16le(1), u16le(24), Buffer.alloc(dib - 16)])
  return pad(Buffer.concat([file, info]), opts.total ?? 0)
}

const riff = (fourcc: string, body: Buffer, total: number): Buffer =>
  pad(Buffer.concat([Buffer.from('RIFF'), u32le(body.length + 12), Buffer.from('WEBP'), Buffer.from(fourcc), u32le(body.length), body]), total)

export const webpLossy = (w: number, h: number, total = 0): Buffer => riff('VP8 ', Buffer.concat([Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]), u16le(w), u16le(h)]), total)
export const webpLossless = (w: number, h: number, total = 0): Buffer => riff('VP8L', Buffer.concat([Buffer.from([0x2f]), u32le((w - 1) | ((h - 1) << 14))]), total)
export const webpExtended = (w: number, h: number, total = 0): Buffer =>
  riff('VP8X', Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from([(w - 1) & 0xff, ((w - 1) >> 8) & 0xff, ((w - 1) >> 16) & 0xff]), Buffer.from([(h - 1) & 0xff, ((h - 1) >> 8) & 0xff, ((h - 1) >> 16) & 0xff])]), total)

export const tiff = (w: number, h: number, bigEndian = false): Buffer => {
  const u16 = bigEndian ? u16be : u16le
  const u32 = bigEndian ? u32be : u32le
  const entry = (tag: number, type: number, value: number): Buffer => Buffer.concat([u16(tag), u16(type), u32(1), type === 3 ? Buffer.concat([u16(value), Buffer.alloc(2)]) : u32(value)])
  return Buffer.concat([Buffer.from(bigEndian ? 'MM' : 'II'), u16(42), u32(8), u16(2), entry(256, 3, w), entry(257, 4, h), u32(0)])
}
