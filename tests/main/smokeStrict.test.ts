import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { cacheProblems, packagedProblems, type SmokeEnv } from '../../src/main/smoke'

const unpacked = join('C:', 'App', 'resources', 'app.asar.unpacked', 'node_modules')
const base: SmokeEnv = {
  packaged: true,
  wasmDir: join(unpacked, 'sql.js', 'dist'),
  workerPath: join(unpacked, 'tesseract.js', 'w.js'),
  langPath: tmpdir(),
  cacheDir: join(tmpdir(), 'cache')
}
const yes = (): boolean => true

describe('packagedProblems', () => {
  it('sin problemas cuando todo viene de app.asar.unpacked y langPath existe', () => {
    expect(packagedProblems(base, true, yes)).toEqual([])
  })
  it('no exige nada fuera del modo empaquetado', () => {
    expect(packagedProblems({ ...base, packaged: false, langPath: undefined, wasmDir: 'x', workerPath: 'y' }, false, yes)).toEqual([])
  })
  it('falla si langPath no está definido', () => {
    expect(packagedProblems({ ...base, langPath: undefined }, true, yes).join()).toMatch(/langPath/)
  })
  it('falla si langPath no existe en disco', () => {
    expect(packagedProblems(base, true, () => false).join()).toMatch(/langPath/)
  })
  it('falla si wasmDir o workerPath no están en app.asar.unpacked', () => {
    const p = packagedProblems({ ...base, wasmDir: join('C:', 'App', 'app.asar', 'sql.js'), workerPath: join('C:', 'dev', 'w.js') }, true, yes)
    expect(p.some((m) => /wasmDir/.test(m))).toBe(true)
    expect(p.some((m) => /workerPath/.test(m))).toBe(true)
  })
  it('falla si el wasm no se cargó de verdad', () => {
    expect(packagedProblems(base, false, yes).join()).toMatch(/wasm/i)
  })
})

describe('cacheProblems', () => {
  const mk = (): { lang: string; cache: string; raw: { spa: Buffer; eng: Buffer } } => {
    const lang = mkdtempSync(join(tmpdir(), 'lang-'))
    const cache = mkdtempSync(join(tmpdir(), 'cache-'))
    const raw = { spa: randomBytes(2000), eng: randomBytes(2000) }
    writeFileSync(join(lang, 'spa.traineddata.gz'), gzipSync(raw.spa))
    writeFileSync(join(lang, 'eng.traineddata.gz'), gzipSync(raw.eng))
    return { lang, cache, raw }
  }
  it('vale si la caché contiene exactamente los datos incluidos', () => {
    const { lang, cache, raw } = mk()
    writeFileSync(join(cache, 'spa.traineddata'), raw.spa)
    writeFileSync(join(cache, 'eng.traineddata'), raw.eng)
    expect(cacheProblems(lang, cache)).toEqual([])
  })
  it('falla si la caché está vacía (el OCR no cargó los idiomas)', () => {
    const { lang, cache } = mk()
    expect(cacheProblems(lang, cache).length).toBe(2)
  })
  it('falla si un idioma de la caché difiere de lo incluido', () => {
    const { lang, cache, raw } = mk()
    writeFileSync(join(cache, 'spa.traineddata'), raw.spa)
    writeFileSync(join(cache, 'eng.traineddata'), randomBytes(2000))
    expect(cacheProblems(lang, cache).join()).toMatch(/eng/)
  })
})
