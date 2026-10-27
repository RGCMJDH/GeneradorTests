import { describe, it, expect } from 'vitest'
import { numbersGrounded, verifyQuote } from '@core/verify'

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

describe('verifyQuote: signos, cifras y límites de palabra', () => {
  it('rechaza un signo menos eliminado', () => {
    expect(verifyQuote('la solución es x = 5', 'la solución es x = -5')).toBe(false)
  })

  it('rechaza un cambio de separador decimal', () => {
    expect(verifyQuote('mide 2.5 metros', 'mide 2,5 metros')).toBe(false)
  })

  it('rechaza una cita que empieza a mitad de palabra', () => {
    expect(verifyQuote('ula es la unidad', 'la célula es la unidad')).toBe(false)
  })

  it('rechaza una cita que termina a mitad de palabra', () => {
    expect(verifyQuote('la célula es la uni', 'la célula es la unidad')).toBe(false)
  })

  it('rechaza un operador de comparación invertido', () => {
    expect(verifyQuote('a < b es mayor', 'a > b es mayor')).toBe(false)
  })

  it('rechaza = frente a ≠', () => {
    expect(verifyQuote('el valor a = b siempre', 'el valor a ≠ b siempre')).toBe(false)
  })

  it('rechaza una cita que empieza tras el signo de un número', () => {
    expect(verifyQuote('5 al final del todo', 'x = -5 al final del todo')).toBe(false)
  })

  it('rechaza una cita que empieza a mitad de un decimal', () => {
    expect(verifyQuote('5 metros de largo', 'mide 2.5 metros de largo')).toBe(false)
  })

  it('acepta el mismo signo con otro guion Unicode y otro espaciado', () => {
    expect(verifyQuote('x=-5 al final', 'el resultado es x = −5 al final')).toBe(true)
  })

  it('acepta ligaduras de PDF frente a letras normales', () => {
    expect(verifyQuote('fibra muscular', 'la ﬁbra muscular se contrae')).toBe(true)
  })

  it('acepta una cita sin el punto final del fragmento', () => {
    expect(verifyQuote('la célula es la unidad', 'la célula es la unidad.')).toBe(true)
  })

  it('acepta cifras y operadores copiados literalmente', () => {
    expect(verifyQuote('V = I · R, es decir V = 2 · 10 = 20 voltios', 'cumple V = I · R, es decir V = 2 · 10 = 20 voltios.')).toBe(true)
    expect(verifyQuote('mide 2,5 metros', 'el tablero mide 2,5 metros.')).toBe(true)
  })
})

describe('verifyQuote: superíndices y fracciones', () => {
  it('rechaza 32 frente a 3²', () => {
    expect(verifyQuote('x = 32 metros', 'el área es x = 3² metros')).toBe(false)
  })

  it('acepta 3^2 frente a 3²', () => {
    expect(verifyQuote('x = 3^2 metros', 'el área es x = 3² metros')).toBe(true)
  })

  it('rechaza la resta 10 - 3 frente a 10⁻³', () => {
    expect(verifyQuote('vale 10 - 3 gramos', 'la masa vale 10⁻³ gramos')).toBe(false)
  })

  it('acepta 10^-3 frente a 10⁻³', () => {
    expect(verifyQuote('vale 10^-3 gramos', 'la masa vale 10⁻³ gramos')).toBe(true)
  })

  it('acepta 1/2 frente a ½ y rechaza 12', () => {
    expect(verifyQuote('toma 1/2 litro', 'se toma ½ litro')).toBe(true)
    expect(verifyQuote('toma 12 litro', 'se toma ½ litro')).toBe(false)
  })
})

describe('numbersGrounded', () => {
  it('3² aporta 3 y 2, no 32', () => {
    expect(numbersGrounded('32', 'A = 3² = 9')).toBe(false)
    expect(numbersGrounded('3^2 = 9', 'A = 3² = 9')).toBe(true)
  })

  const chunkText = 'Una resistencia de 10 ohmios con 2,5 amperios da V = 25 voltios.'

  it('acepta texto sin números o con números del fragmento', () => {
    expect(numbersGrounded('Se aplica la ley de Ohm.', chunkText)).toBe(true)
    expect(numbersGrounded('V = 10 · 2,5 = 25 voltios', chunkText)).toBe(true)
  })

  it('rechaza un número ausente del fragmento', () => {
    expect(numbersGrounded('V = 30 voltios', chunkText)).toBe(false)
  })

  it('compara la cadena exacta: 2.5 no es 2,5', () => {
    expect(numbersGrounded('2.5 amperios', chunkText)).toBe(false)
  })

  it('normaliza dígitos de ancho completo (NFKC)', () => {
    expect(numbersGrounded('１０ ohmios', chunkText)).toBe(true)
  })
})
