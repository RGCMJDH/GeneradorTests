import { describe, it, expect } from 'vitest'
import { mergeConcepts } from '@core/conceptMerge'
import type { Concept } from '@core/types'

const order = (ids: number[]) => new Map(ids.map((id, i) => [id, i]))

describe('mergeConcepts', () => {
  it('quita los chunks reemplazados, descarta los conceptos vacíos y añade los nuevos', () => {
    const existing: Concept[] = [
      { term: 'ADN', chunkIds: [1, 3], related: ['ATP'] },
      { term: 'ATP', chunkIds: [1], related: ['ADN'] },
      { term: 'ribosomas', chunkIds: [3], related: [] }
    ]
    const fresh: Concept[] = [{ term: 'lípidos', chunkIds: [2], related: [] }]
    const out = mergeConcepts(existing, fresh, new Set([1, 2]), order([1, 2, 3]))
    expect(out).toEqual([
      { term: 'ADN', chunkIds: [3], related: ['ribosomas'] }, // ATP ya no existe; ahora comparte el chunk 3 con ribosomas
      { term: 'lípidos', chunkIds: [2], related: [] },
      { term: 'ribosomas', chunkIds: [3], related: ['ADN'] }
    ])
  })

  it('un mismo término en lo existente y lo nuevo es un único concepto con los chunks unidos y ordenados', () => {
    const existing: Concept[] = [
      { term: 'ADN', chunkIds: [3], related: ['ribosomas'] },
      { term: 'ribosomas', chunkIds: [3], related: ['ADN'] }
    ]
    const fresh: Concept[] = [
      { term: 'adn', chunkIds: [1, 2], related: ['lípidos'] },
      { term: 'lípidos', chunkIds: [1], related: ['adn'] }
    ]
    const out = mergeConcepts(existing, fresh, new Set([1, 2]), order([1, 2, 3]))
    const adn = out.filter((c) => c.term.toLowerCase() === 'adn')
    expect(adn).toHaveLength(1)
    expect(adn[0].term).toBe('ADN') // misma longitud: gana la existente
    expect(adn[0].chunkIds).toEqual([1, 2, 3])
    expect(adn[0].related).toEqual(['lípidos', 'ribosomas'])
    expect(out[0].term).toBe('ADN') // más chunks primero
  })

  it('si cambia la grafía mostrada, los relacionados de otros conceptos siguen apuntando al término', () => {
    const existing: Concept[] = [
      { term: 'Núcleo celular', chunkIds: [3], related: ['ribosomas'] },
      { term: 'ribosomas', chunkIds: [3], related: ['Núcleo celular'] }
    ]
    // Misma clave normalizada pero grafía más corta: "nucleo  celular" no, usamos puntuación para alargar la existente.
    const longer: Concept[] = [
      { term: 'núcleo celular.', chunkIds: [3], related: ['ribosomas'] },
      { term: 'ribosomas', chunkIds: [3], related: ['núcleo celular.'] }
    ]
    const fresh: Concept[] = [{ term: 'núcleo celular', chunkIds: [1], related: [] }]
    const out = mergeConcepts(longer, fresh, new Set([1]), order([1, 3]))
    expect(out.find((c) => c.term === 'núcleo celular')!.chunkIds).toEqual([1, 3])
    expect(out.find((c) => c.term === 'ribosomas')!.related).toEqual(['núcleo celular'])
    void existing
  })

  it('related se recalcula con los chunks resultantes: sin chunk en común ya no hay relación', () => {
    // A y B compartían solo el chunk 1; al reextraerlo solo queda A ahí. B sigue por el chunk 2.
    const existing: Concept[] = [
      { term: 'A', chunkIds: [1], related: ['B'] },
      { term: 'B', chunkIds: [1, 2], related: ['A', 'C'] },
      { term: 'C', chunkIds: [2], related: ['B'] }
    ]
    const fresh: Concept[] = [{ term: 'A', chunkIds: [1], related: [] }]
    const out = mergeConcepts(existing, fresh, new Set([1]), order([1, 2]))
    const by = (t: string) => out.find((c) => c.term === t)!
    expect(by('A').related).toEqual([])
    expect(by('B').related).toEqual(['C'])
    expect(by('C').related).toEqual(['B'])
  })

  it('related ignora lo que traían los conceptos: manda la co-ocurrencia actual', () => {
    const existing: Concept[] = [
      { term: 'A', chunkIds: [1], related: ['Z'] },
      { term: 'Z', chunkIds: [9], related: ['A'] }
    ]
    const out = mergeConcepts(existing, [], new Set(), order([1, 9]))
    expect(out.every((c) => c.related.length === 0)).toBe(true)
  })

  it('related se acota a 10 y se ordena', () => {
    const many = Array.from({ length: 14 }, (_, i) => `termino ${String.fromCharCode(97 + i)}`)
    const fresh: Concept[] = [
      { term: 'centro', chunkIds: [1], related: many },
      ...many.map((t): Concept => ({ term: t, chunkIds: [1], related: ['centro'] }))
    ]
    const centro = mergeConcepts([], fresh, new Set([1]), order([1])).find((c) => c.term === 'centro')!
    expect(centro.related).toHaveLength(10)
    expect([...centro.related].sort((a, b) => a.localeCompare(b, 'es'))).toEqual(centro.related)
  })
})
