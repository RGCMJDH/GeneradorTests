import { describe, it, expect } from 'vitest'
import { resolveDevUrl } from '../../src/main/navigation'

describe('resolveDevUrl', () => {
  it('en desarrollo devuelve ELECTRON_RENDERER_URL', () => {
    expect(resolveDevUrl(false, { ELECTRON_RENDERER_URL: 'http://localhost:5173' })).toBe('http://localhost:5173')
  })
  it('empaquetada ignora la variable de entorno (nadie puede cargar otra URL)', () => {
    expect(resolveDevUrl(true, { ELECTRON_RENDERER_URL: 'https://evil.example' })).toBeUndefined()
  })
  it('sin variable o vacía devuelve undefined', () => {
    expect(resolveDevUrl(false, {})).toBeUndefined()
    expect(resolveDevUrl(false, { ELECTRON_RENDERER_URL: '' })).toBeUndefined()
  })
})
