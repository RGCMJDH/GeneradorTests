import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chunkText } from '@core/chunker'
import { normalize } from '@core/normalize'

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/apuntes-ejemplo.md', import.meta.url)),
  'utf8'
)

const longParagraph = Array.from(
  { length: 60 },
  (_, i) => `La sentencia número ${i + 1} describe un proceso biológico distinto, con detalle suficiente.`
).join(' ')

describe('chunkText', () => {
  it('divide por párrafos sin superar maxChars', () => {
    const chunks = chunkText(fixture, { maxChars: 600 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600)
    // cada chunk empieza y termina en límite de párrafo del original
    for (const c of chunks) expect(fixture.replace(/\r\n/g, '\n')).toContain(c.split('\n\n')[0])
  })

  it('agrupa párrafos pequeños en un solo chunk con el maxChars por defecto', () => {
    const chunks = chunkText('Uno.\n\nDos.\n\nTres.')
    expect(chunks).toEqual(['Uno.\n\nDos.\n\nTres.'])
  })

  it('un párrafo mayor que maxChars se parte por frases', () => {
    const chunks = chunkText(longParagraph, { maxChars: 300 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(300)
      expect(c.endsWith('.')).toBe(true)
      expect(longParagraph).toContain(c)
    }
  })

  it('no pierde ni duplica texto (concatenar chunks normalizados == texto normalizado)', () => {
    for (const input of [fixture, longParagraph]) {
      for (const maxChars of [200, 600, 1200]) {
        const chunks = chunkText(input, { maxChars })
        expect(normalize(chunks.join(' '))).toBe(normalize(input))
      }
    }
  })

  it('texto vacío → []', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   \n\n  \r\n ')).toEqual([])
  })

  it('maneja \r\n y varias líneas en blanco entre párrafos', () => {
    const input = 'Primero.\r\n\r\n\r\n\r\nSegundo.\r\n  \r\nTercero.'
    const chunks = chunkText(input, { maxChars: 12 })
    expect(chunks).toEqual(['Primero.', 'Segundo.', 'Tercero.'])
    expect(chunks.join('')).not.toContain('\r')
  })

  it('parte una frase sin puntuación mayor que maxChars por palabras, sin cortar palabras', () => {
    const input = Array.from({ length: 50 }, (_, i) => `palabra${i}`).join(' ')
    const chunks = chunkText(input, { maxChars: 100 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
    expect(normalize(chunks.join(' '))).toBe(normalize(input))
  })
})
