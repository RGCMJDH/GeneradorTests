import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { emit, isInsideTmp } from '../../src/main/smoke'

describe('GT_SMOKE_OUT', () => {
  it('solo acepta rutas dentro de os.tmpdir()', () => {
    expect(isInsideTmp(join(tmpdir(), 'salida.txt'))).toBe(true)
    expect(isInsideTmp(join(tmpdir(), 'sub', 'salida.txt'))).toBe(true)
  })
  it('rechaza la propia carpeta temporal, rutas fuera y escapes con ..', () => {
    expect(isInsideTmp(tmpdir())).toBe(false)
    expect(isInsideTmp(join(dirname(tmpdir()), 'otra', 'x.txt'))).toBe(false)
    expect(isInsideTmp(join(tmpdir(), '..', 'x.txt'))).toBe(false)
    expect(isInsideTmp(join(process.cwd(), 'out.txt'))).toBe(false)
  })
})

describe('emit', () => {
  const saved = process.env['GT_SMOKE_OUT']
  afterEach(() => {
    if (saved === undefined) delete process.env['GT_SMOKE_OUT']
    else process.env['GT_SMOKE_OUT'] = saved
  })
  it('escribe en GT_SMOKE_OUT dentro de tmp y se niega a escribir fuera de tmp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emit-'))
    const inside = join(dir, 'out.txt')
    process.env['GT_SMOKE_OUT'] = inside
    await emit('hola')
    expect(readFileSync(inside, 'utf8')).toBe('hola\n')

    const outside = join(process.cwd(), 'gt-emit-outside.txt')
    process.env['GT_SMOKE_OUT'] = outside
    await emit('no')
    expect(existsSync(outside)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
