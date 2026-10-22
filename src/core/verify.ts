import { normalize } from './normalize'

export const MIN_QUOTE_LENGTH = 8

/**
 * Anti-alucinación: la cita debe ser una subcadena del fragmento (tras normalizar
 * ambos) y tener al menos MIN_QUOTE_LENGTH caracteres normalizados.
 */
export function verifyQuote(quote: string, chunkText: string): boolean {
  const q = normalize(quote)
  if (q.length < MIN_QUOTE_LENGTH) return false
  return normalize(chunkText).includes(q)
}
