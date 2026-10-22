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
