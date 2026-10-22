import type { Concept } from './types'
import { normalize } from './normalize'

export const MAX_RELATED = 10

export const byLocale = (a: string, b: string): number => a.localeCompare(b, 'es') || (a < b ? -1 : a > b ? 1 : 0)

/** Más fragmentos primero; a igualdad, alfabético. */
export const compareConcepts = (a: Concept, b: Concept): number => b.chunkIds.length - a.chunkIds.length || byLocale(a.term, b.term)

interface Group {
  term: string
  chunkIds: Set<number>
  related: Set<string> // claves normalizadas
}

/**
 * Mezcla el resultado de una extracción parcial (`fresh`) con el índice guardado (`existing`).
 * De `existing` se quitan los chunks en `replaced` (los analizados con éxito ahora); lo que queda sin chunks desaparece.
 * Un mismo término (por clave normalizada) es un único concepto con los chunks unidos, en el orden de `order`
 * (posición de cada chunk en la asignatura) y la grafía más corta (a igualdad, la ya guardada). `related` es la unión,
 * limitada a conceptos que siguen existiendo, ordenada y acotada a 10.
 */
export function mergeConcepts(existing: Concept[], fresh: Concept[], replaced: ReadonlySet<number>, order: ReadonlyMap<number, number>): Concept[] {
  const groups = new Map<string, Group>()
  const add = (c: Concept, chunkIds: number[]): void => {
    const key = normalize(c.term)
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { term: c.term, chunkIds: new Set(), related: new Set() }))
    else if (c.term.length < g.term.length) g.term = c.term
    for (const id of chunkIds) g.chunkIds.add(id)
    for (const r of c.related) g.related.add(normalize(r))
  }
  for (const c of existing) {
    const kept = c.chunkIds.filter((id) => !replaced.has(id))
    if (kept.length > 0) add(c, kept)
  }
  for (const c of fresh) if (c.chunkIds.length > 0) add(c, c.chunkIds)

  const pos = (id: number): number => order.get(id) ?? Number.MAX_SAFE_INTEGER
  const merged: Concept[] = [...groups].map(([key, g]) => ({
    term: g.term,
    chunkIds: [...g.chunkIds].sort((a, b) => pos(a) - pos(b) || a - b),
    related: [...g.related]
      .filter((k) => k !== key && groups.has(k))
      .map((k) => (groups.get(k) as Group).term)
      .sort(byLocale)
      .slice(0, MAX_RELATED)
  }))
  return merged.sort(compareConcepts)
}
