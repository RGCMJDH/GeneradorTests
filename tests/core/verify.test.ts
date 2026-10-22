import { describe, it, expect } from 'vitest'
import { verifyQuote } from '@core/verify'

const chunk =
  'La mitocondria es el orgánulo encargado de producir energía en forma de ATP. ' +
  'El núcleo celular contiene el material genético.'

describe('verifyQuote', () => {
  it('acepta cita literal', () => {
    expect(verifyQuote('El núcleo celular contiene el material genético.', chunk)).toBe(true)
  })

  it('acepta cita con distintas mayúsculas, tildes y espacios múltiples', () => {
    expect(verifyQuote('  LA   MITOCONDRIA es el   organulo encargado de PRODUCIR energia ', chunk)).toBe(true)
  })

  it('rechaza cita inventada', () => {
    expect(verifyQuote('El ribosoma sintetiza proteínas en el citoplasma.', chunk)).toBe(false)
  })

  it('rechaza cita alterada en una palabra', () => {
    expect(verifyQuote('La mitocondria es el orgánulo encargado de destruir energía', chunk)).toBe(false)
  })

  it('rechaza cita vacía o de menos de 8 caracteres normalizados', () => {
    expect(verifyQuote('', chunk)).toBe(false)
    expect(verifyQuote('   ', chunk)).toBe(false)
    expect(verifyQuote('ATP', chunk)).toBe(false)
    expect(verifyQuote('El  núcleo', 'El núcleo celular')).toBe(true) // 9 chars: ok
    expect(verifyQuote('núcleo', chunk)).toBe(false) // 6 chars
  })
})
