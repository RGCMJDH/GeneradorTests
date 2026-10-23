// Prepara build-tessdata/{spa,eng}.traineddata.gz para empaquetarlos (extraResources → resources/tessdata).
// Origen ÚNICO: los paquetes npm @tesseract.js-data/{spa,eng} fijados en devDependencies (la integridad la cubre package-lock.json).
// Sin red ni CDN. Cada archivo se verifica (tamaño, firma gzip, SHA-256 de scripts/tessdata.sha256.json) antes y después de copiarlo;
// cualquier discrepancia aborta con código 1. Datos: tessdata_best (Apache-2.0).
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyBundle } from './tessdata-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build-tessdata')
const LANGS = ['spa', 'eng']
const VARIANT = '4.0.0_best_int'
const hashes = JSON.parse(readFileSync(join(root, 'scripts', 'tessdata.sha256.json'), 'utf8'))

const srcDir = (lang) => join(root, 'node_modules', '@tesseract.js-data', lang, VARIANT)
const fail = (problems) => {
  console.error('tessdata: verificación fallida, se aborta el empaquetado:\n  ' + problems.join('\n  '))
  process.exit(1)
}

// 1) El origen debe coincidir con el hash registrado ANTES de copiarlo.
for (const lang of LANGS) {
  const problems = verifyBundle(srcDir(lang), { [`${lang}.traineddata.gz`]: hashes[`${lang}.traineddata.gz`] }, [lang])
  if (problems.length) fail(problems)
}

// 2) Copia atómica (archivo temporal + rename); siempre se sobrescribe, nunca se confía en lo que hubiera.
mkdirSync(outDir, { recursive: true })
for (const lang of LANGS) {
  const name = `${lang}.traineddata.gz`
  const tmp = join(outDir, `${name}.tmp-${process.pid}`)
  try {
    copyFileSync(join(srcDir(lang), name), tmp)
    renameSync(tmp, join(outDir, name))
  } finally {
    rmSync(tmp, { force: true })
  }
}
writeFileSync(
  join(outDir, 'NOTICE.txt'),
  'Datos de idioma de Tesseract OCR (tessdata_best, variante entera) distribuidos bajo licencia Apache-2.0.\n' +
    'Paquetes npm: @tesseract.js-data/spa@1.0.0 y @tesseract.js-data/eng@1.0.0.\n' +
    'https://github.com/tesseract-ocr/tessdata_best  ·  https://www.apache.org/licenses/LICENSE-2.0\n'
)

// 3) Verificación final de lo que se va a empaquetar.
const problems = verifyBundle(outDir, hashes, LANGS)
if (problems.length) fail(problems)
console.log('tessdata: spa y eng verificados en build-tessdata/')
