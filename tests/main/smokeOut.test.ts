import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { isInsideTmp } from '../../src/main/smoke'

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
