import type { Concept } from './types'
import { normalize } from './normalize'

export const MAX_RELATED = 10

export const byLocale = (a: string, b: string): number => a.localeCompare(b, 'es') || (a < b ? -1 : a > b ? 1 : 0)

/** Más fragmentos primero; a igualdad, alfabético. */
export const compareConcepts = (a: Concept, b: Concept): number => b.chunkIds.length - a.chunkIds.length || byLocale(a.term, b.term)

interface Group {
  term: string
  chunkIds: Set<number>
}

/**
 * Mezcla el resultado de una extracción parcial (`fresh`) con el índice guardado (`existing`).
 * De `existing` se quitan los chunks en `replaced` (los analizados con éxito ahora); lo que queda sin chunks desaparece.
 * Un mismo término (por clave normalizada) es un único concepto con los chunks unidos, en el orden de `order`
 * (posición de cada chunk en la asignatura) y la grafía más corta (a igualdad, la ya guardada). `related` se RECALCULA
 * para todos desde los chunks resultantes (otros términos que comparten al menos un chunk): lo que traían los conceptos
 * guardados se ignora, para no arrastrar relaciones que ya no se sostienen. Ordenado y acotado a 10.
 */
export function mergeConcepts(existing: Concept[], fresh: Concept[], replaced: ReadonlySet<number>, order: ReadonlyMap<number, number>): Concept[] {
  const groups = new Map<string, Group>()
  const add = (c: Concept, chunkIds: number[]): void => {
    const key = normalize(c.term)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { term: c.term, chunkIds: new Set() }))
    else if (c.term.length < g.term.length) g.term = c.term
    for (const id of chunkIds) g.chunkIds.add(id)
  }
  for (const c of existing) {
    const kept = c.chunkIds.filter((id) => !replaced.has(id))
    if (kept.length > 0) add(c, kept)
  }
  for (const c of fresh) if (c.chunkIds.length > 0) add(c, c.chunkIds)

  const pos = (id: number): number => order.get(id) ?? Number.MAX_SAFE_INTEGER
  // chunk -> términos que lo contienen (por clave normalizada)
  const inChunk = new Map<number, string[]>()
  for (const [key, g] of groups) for (const id of g.chunkIds) inChunk.set(id, [...(inChunk.get(id) ?? []), key])
  const merged: Concept[] = [...groups].map(([key, g]) => {
    const mates = new Set<string>()
    for (const id of g.chunkIds) for (const k of inChunk.get(id) ?? []) if (k !== key) mates.add(k)
    return {
      term: g.term,
      chunkIds: [...g.chunkIds].sort((a, b) => pos(a) - pos(b) || a - b),
      related: [...mates]
        .map((k) => (groups.get(k) as Group).term)
        .sort(byLocale)
        .slice(0, MAX_RELATED)
    }
  })
  return merged.sort(compareConcepts)
}
