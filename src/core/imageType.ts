export type ImageKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'webp'

const startsWith = (b: Buffer, sig: number[], at = 0): boolean => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v)

/**
 * Tipo de imagen según los PRIMEROS BYTES (nunca según nombre ni Content-Type).
 * Devuelve 'heic' para HEIC/HEIF (contenedor ISO-BMFF: caja 'ftyp' en 4-8 y marca en 8-12), que ni Tesseract ni Leptonica leen,
 * y null si no es ninguno de los formatos soportados.
 */
export function detectImageType(b: Buffer): ImageKind | 'heic' | null {
  if (startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) && b.length >= 12 && ['heic', 'heix', 'hevc', 'mif1', 'heif'].includes(b.toString('latin1', 8, 12))) return 'heic'
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(b, [0x42, 0x4d])) return 'bmp'
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff'
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}
