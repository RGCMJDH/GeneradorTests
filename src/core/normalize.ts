/**
 * Normaliza texto para comparación tolerante: sin diacríticos, minúsculas,
 * puntuación convertida en espacio y espacios colapsados.
 */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * ¿Aparece `term` como palabra(s) completa(s) en `text`? Ambos YA normalizados.
 * Se rodea con espacios para respetar los límites de palabra ("cel" no está en "celula").
 */
export function containsTerm(normText: string, normTerm: string): boolean {
  return normTerm !== '' && ` ${normText} `.includes(` ${normTerm} `)
}
