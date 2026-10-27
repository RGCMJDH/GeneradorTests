export const MIN_QUOTE_LENGTH = 8

// Variantes Unicode del guion/menos que se tratan como "-" (guion, guion duro, figura, en dash, signo menos).
const DASHES = /[‐-–−﹣]/g
const OPERATORS = '=<>≠≤≥+\\-×·*/^%±≈√'
const IS_OPERATOR = new RegExp(`^[${OPERATORS}]$`, 'u')
// Números con separadores internos (2,5 · 1.000.000), palabras (letras y cifras pegadas) y operadores sueltos.
// El resto (espacios y puntuación de prosa) solo separa tokens.
const TOKEN = new RegExp(`\\d+(?:[.,]\\d+)*|\\p{L}[\\p{L}\\p{N}]*|[${OPERATORS}]`, 'gu')

/**
 * Trocea el texto en tokens para comparar citas sin perder lo que cambia el sentido:
 * cifras, separador decimal, signos y operadores. Tolera mayúsculas, tildes, ligaduras
 * (NFKC), espaciado y la puntuación de prosa. Las tildes solo se quitan a las letras:
 * "≠" se descompone en "=" + marca combinante y no debe acabar como "=".
 * Un "-" pegado a un número es su signo, salvo que el "-" vaya pegado a una palabra
 * o número anterior ("10-5" es una resta).
 */
export function quoteTokens(s: string): string[] {
  const text = s
    .normalize('NFKC')
    .replace(/\p{L}\p{M}*/gu, (ch) => ch.normalize('NFD').replace(/\p{M}+/gu, ''))
    .toLowerCase()
    .replace(DASHES, '-')
  const out: { tok: string; start: number; end: number }[] = []
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0]
    const start = m.index
    const minus = out[out.length - 1]
    if (/^\d/.test(tok) && minus?.tok === '-' && minus.end === start) {
      const before = out[out.length - 2]
      const glued = before !== undefined && !IS_OPERATOR.test(before.tok) && before.end === minus.start
      if (!glued) {
        out[out.length - 1] = { tok: `-${tok}`, start: minus.start, end: start + tok.length }
        continue
      }
    }
    out.push({ tok, start, end: start + tok.length })
  }
  return out.map((t) => t.tok)
}

/**
 * Anti-alucinación: la cita debe aparecer como secuencia contigua de tokens completos del
 * fragmento y tener al menos MIN_QUOTE_LENGTH caracteres. No empieza ni acaba a mitad de
 * palabra o de número, y un signo, un decimal o un operador distinto la invalidan.
 */
export function verifyQuote(quote: string, chunkText: string): boolean {
  const q = quoteTokens(quote).join(' ')
  if (q.length < MIN_QUOTE_LENGTH) return false
  return ` ${quoteTokens(chunkText).join(' ')} `.includes(` ${q} `)
}

/**
 * ¿Todos los números de `text` aparecen tal cual (mismo signo y separador decimal) en el fragmento?
 * Detecta datos o resultados inventados en un texto que no es una cita literal.
 */
export function numbersGrounded(text: string, chunkText: string): boolean {
  const isNumber = (t: string): boolean => /^-?\d/.test(t)
  const known = new Set(quoteTokens(chunkText).filter(isNumber))
  return quoteTokens(text).filter(isNumber).every((n) => known.has(n))
}
