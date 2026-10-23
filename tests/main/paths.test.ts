import { describe, it, expect } from 'vitest'
import { sqlWasmDir, tesseractWorkerPath, toUnpacked } from '../../src/main/paths'

const BS = String.fromCharCode(92)
const win = (p: string): string => p.split('/').join(BS)

describe('toUnpacked', () => {
  const packed = win('C:/App/resources/app.asar/node_modules/tesseract.js/src/w.js')
  it('reescribe app.asar → app.asar.unpacked si la copia existe (Windows y POSIX)', () => {
    expect(toUnpacked(packed, () => true)).toBe(win('C:/App/resources/app.asar.unpacked/node_modules/tesseract.js/src/w.js'))
    expect(toUnpacked('/opt/res/app.asar/node_modules/x', () => true)).toBe('/opt/res/app.asar.unpacked/node_modules/x')
  })
  it('deja la ruta igual si la copia desempaquetada no existe', () => {
    expect(toUnpacked(packed, () => false)).toBe(packed)
  })
  it('no toca rutas fuera de un asar (desarrollo) ni nombres parecidos', () => {
    const dev = win('C:/dev/node_modules/sql.js/dist')
    expect(toUnpacked(dev, () => true)).toBe(dev)
    expect(toUnpacked('/x/myapp.asarx/f', () => true)).toBe('/x/myapp.asarx/f')
  })
  it('sqlWasmDir y tesseractWorkerPath resuelven con la función inyectada', () => {
    expect(sqlWasmDir(() => '/r/app.asar/node_modules/sql.js/dist/sql-wasm.wasm')).toMatch(/sql\.js[\\/]dist$/)
    expect(tesseractWorkerPath(() => '/r/node_modules/tesseract.js/src/worker-script/node/index.js')).toMatch(/worker-script/)
  })
})
