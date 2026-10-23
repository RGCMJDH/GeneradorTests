// Prepara build/tessdata/{spa,eng}.traineddata.gz para empaquetarlos (extraResources → resources/tessdata).
// Origen: 1) .cache/tessdata (datos ya descargados por tesseract.js, se comprimen aquí) o 2) el mismo CDN que usa tesseract.js.
// Datos: tessdata_best_int (Apache-2.0, redistribuibles); ver NOTICE.txt que se escribe junto a ellos.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build', 'tessdata')
const cacheDir = join(root, '.cache', 'tessdata')
const CDN = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data'
const VERSION = '4.0.0_best_int'

mkdirSync(outDir, { recursive: true })
for (const lang of ['spa', 'eng']) {
  const target = join(outDir, `${lang}.traineddata.gz`)
  if (existsSync(target)) continue
  const cached = join(cacheDir, `${lang}.traineddata`)
  if (existsSync(cached)) {
    writeFileSync(target, gzipSync(readFileSync(cached)))
    console.log(`tessdata: ${lang} desde .cache`)
  } else {
    const res = await fetch(`${CDN}/${lang}/${VERSION}/${lang}.traineddata.gz`)
    if (!res.ok) throw new Error(`No se pudo descargar ${lang}.traineddata.gz (HTTP ${res.status})`)
    writeFileSync(target, Buffer.from(await res.arrayBuffer()))
    console.log(`tessdata: ${lang} descargado`)
  }
}
writeFileSync(
  join(outDir, 'NOTICE.txt'),
  'Datos de idioma de Tesseract OCR (tessdata_best, variante entera) distribuidos bajo licencia Apache-2.0.\n' +
    'https://github.com/tesseract-ocr/tessdata_best  ·  https://www.apache.org/licenses/LICENSE-2.0\n'
)
