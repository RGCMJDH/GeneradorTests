import { describe, it, expect, beforeAll } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { verifyTessdataFile, verifyBundle } from '../../scripts/tessdata-lib.mjs'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const bigGzip = (): Buffer => gzipSync(randomBytes(1_500_000), { level: 0 }) // >1 MB aunque sea incompresible

describe('verifyTessdataFile', () => {
  let dir: string
  let good: Buffer
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tessdata-'))
    good = bigGzip()
    writeFileSync(join(dir, 'ok.gz'), good)
  })

  it('acepta un gzip del tamaño esperado con el hash correcto', () => {
    expect(verifyTessdataFile(join(dir, 'ok.gz'), sha(good))).toEqual({ ok: true })
  })
  it('rechaza una página HTML de error aunque tenga tamaño suficiente', () => {
    const html = Buffer.from('<html>' + 'x'.repeat(1_200_000) + '</html>')
    writeFileSync(join(dir, 'err.gz'), html)
    const r = verifyTessdataFile(join(dir, 'err.gz'), sha(html))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/gzip/i)
  })
  it('rechaza un archivo truncado', () => {
    writeFileSync(join(dir, 'trunc.gz'), good.subarray(0, 400_000))
    const r = verifyTessdataFile(join(dir, 'trunc.gz'), sha(good))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/tamaño|pequeño/i)
  })
  it('rechaza un gzip válido con un hash distinto', () => {
    const r = verifyTessdataFile(join(dir, 'ok.gz'), sha(Buffer.from('otro')))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/sha-256/i)
  })
  it('rechaza un archivo que no existe', () => {
    const r = verifyTessdataFile(join(dir, 'nada.gz'), sha(good))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/no existe/i)
  })
})

describe('verifyBundle', () => {
  it('falla si falta un idioma', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessdata-'))
    const good = bigGzip()
    writeFileSync(join(dir, 'spa.traineddata.gz'), good)
    const problems = verifyBundle(dir, { 'spa.traineddata.gz': sha(good), 'eng.traineddata.gz': sha(good) }, ['spa', 'eng'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/eng/)
  })
  it('falla si no hay hash registrado para un idioma', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessdata-'))
    const good = bigGzip()
    writeFileSync(join(dir, 'spa.traineddata.gz'), good)
    expect(verifyBundle(dir, {}, ['spa']).join()).toMatch(/hash/i)
  })
  it('devuelve lista vacía si todo coincide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tessdata-'))
    const a = bigGzip()
    const b = bigGzip()
    writeFileSync(join(dir, 'spa.traineddata.gz'), a)
    writeFileSync(join(dir, 'eng.traineddata.gz'), b)
    expect(verifyBundle(dir, { 'spa.traineddata.gz': sha(a), 'eng.traineddata.gz': sha(b) }, ['spa', 'eng'])).toEqual([])
  })
})
