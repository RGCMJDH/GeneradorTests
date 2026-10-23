// Verificación de los datos de idioma de Tesseract que se empaquetan (sin dependencias de Electron).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Un traineddata comprimido real pesa varios MB; por debajo es una descarga cortada o una página de error. */
export const MIN_BYTES = 1_000_000

/** Comprueba existencia, tamaño, firma gzip (1f 8b) y SHA-256. Devuelve { ok: true } o { ok: false, reason }. */
export function verifyTessdataFile(path, expectedSha256) {
  if (!existsSync(path)) return { ok: false, reason: `${path} no existe` }
  const data = readFileSync(path)
  if (data.length < MIN_BYTES) return { ok: false, reason: `${path}: tamaño ${data.length} B demasiado pequeño (mínimo ${MIN_BYTES} B)` }
  if (data[0] !== 0x1f || data[1] !== 0x8b) return { ok: false, reason: `${path}: no es un archivo gzip (falta la firma 1f8b)` }
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== expectedSha256) return { ok: false, reason: `${path}: SHA-256 ${actual} distinto del esperado ${expectedSha256}` }
  return { ok: true }
}

/** Verifica `<lang>.traineddata.gz` de cada idioma contra `hashes` (nombre de archivo → SHA-256). Devuelve la lista de problemas. */
export function verifyBundle(dir, hashes, langs) {
  const problems = []
  for (const lang of langs) {
    const name = `${lang}.traineddata.gz`
    const expected = hashes[name]
    if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected)) {
      problems.push(`${name}: no hay hash SHA-256 registrado en scripts/tessdata.sha256.json`)
      continue
    }
    const r = verifyTessdataFile(join(dir, name), expected)
    if (!r.ok) problems.push(r.reason)
  }
  return problems
}
