export type ImageKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'webp'

const startsWith = (b: Buffer, sig: number[], at = 0): boolean => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)

/** Tamaños de cabecera DIB que puede llevar un BMP real (CORE, INFO, V2-V5...). */
const DIB_SIZES = [12, 40, 52, 56, 64, 108, 124]

/**
 * Tipo de imagen según los PRIMEROS BYTES (nunca según nombre ni Content-Type).
 * Devuelve 'heic' para HEIC/HEIF (contenedor ISO-BMFF: caja 'ftyp' en 4-8 y marca en 8-12), que ni Tesseract ni Leptonica leen,
 * y null si no es ninguno de los formatos soportados. Un BMP exige además su BITMAPFILEHEADER (14 bytes) y un tamaño de DIB plausible:
 * con solo «BM» cualquier texto que empiece así pasaría por imagen.
 */
export function detectImageType(b: Buffer): ImageKind | 'heic' | null {
  if (startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) && b.length >= 12 && ['heic', 'heix', 'hevc', 'mif1', 'heif'].includes(b.toString('latin1', 8, 12))) return 'heic'
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(b, [0x42, 0x4d]) && b.length >= 18 && DIB_SIZES.includes(b.readUInt32LE(14))) return 'bmp'
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

export interface ImageSize {
  width: number
  height: number
}

const valid = (width: number, height: number): ImageSize | null => (width > 0 && height > 0 ? { width, height } : null)

/** SOF0-SOF15, salvo DHT (C4), JPG (C8) y DAC (CC), que comparten rango pero no son cabeceras de fotograma. */
const isSof = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc

function jpegSize(b: Buffer): ImageSize | null {
  let i = 2
  for (let guard = 0; guard < 10_000 && i + 4 <= b.length; guard++) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) { // relleno
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // sin longitud
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // fin / datos: ya no habrá SOF
    const length = b.readUInt16BE(i + 2)
    if (isSof(marker)) return i + 9 <= b.length ? valid(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)) : null
    if (length < 2) return null
    i += 2 + length
  }
  return null
}

function webpSize(b: Buffer): ImageSize | null {
  const kind = b.toString('latin1', 12, 16)
  if (kind === 'VP8 ' && b.length >= 30 && startsWith(b, [0x9d, 0x01, 0x2a], 23)) return valid(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
  if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21)
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (kind === 'VP8X' && b.length >= 30) return valid(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1)
  return null
}

function tiffSize(b: Buffer): ImageSize | null {
  const le = b[0] === 0x49
  const u16 = (o: number): number => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (o: number): number => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  if (b.length < 8) return null
  const ifd = u32(4)
  if (ifd + 2 > b.length) return null
  const count = Math.min(u16(ifd), 256)
  let width = 0
  let height = 0
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12
    if (e + 12 > b.length) return null
    const tag = u16(e)
    if (tag !== 256 && tag !== 257) continue
    const value = u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8) // SHORT o LONG
    if (tag === 256) width = value
    else height = value
  }
  return valid(width, height)
}

/**
 * Ancho y alto declarados en la CABECERA (sin decodificar los píxeles), para rechazar imágenes enormes antes del OCR.
 * Null si el formato no es reconocible, la cabecera está truncada o las dimensiones no son válidas. Nunca lanza.
 */
export function readImageSize(b: Buffer): ImageSize | null {
  try {
    switch (detectImageType(b)) {
      case 'png':
        return b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR' ? valid(b.readUInt32BE(16), b.readUInt32BE(20)) : null
      case 'jpeg':
        return jpegSize(b)
      case 'gif':
        return b.length >= 10 ? valid(b.readUInt16LE(6), b.readUInt16LE(8)) : null
      case 'bmp': {
        if (b.readUInt32LE(14) === 12) return b.length >= 22 ? valid(b.readUInt16LE(18), b.readUInt16LE(20)) : null
        return b.length >= 26 ? valid(Math.abs(b.readInt32LE(18)), Math.abs(b.readInt32LE(22))) : null
      }
      case 'webp':
        return webpSize(b)
      case 'tiff':
        return tiffSize(b)
      default:
        return null
    }
  } catch {
    return null
  }
}
