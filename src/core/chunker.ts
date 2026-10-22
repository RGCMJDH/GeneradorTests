/**
 * Divide texto en fragmentos de como máximo `maxChars` caracteres.
 * Cada fragmento contiene texto literal del original (solo se recortan
 * espacios en los bordes y se unifican los saltos de línea a \n), de modo
 * que sirva como fuente para verificar citas.
 */
export function chunkText(text: string, opts: { maxChars?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 1200
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  const chunks: string[] = []
  let current = ''

  const push = (piece: string, sep: string): void => {
    if (current === '') {
      current = piece
    } else if (current.length + sep.length + piece.length <= maxChars) {
      current += sep + piece
    } else {
      chunks.push(current)
      current = piece
    }
  }

  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      push(p, '\n\n')
      continue
    }
    // Párrafo largo: cerrar el chunk en curso y empaquetar sus frases aparte.
    if (current !== '') chunks.push(current)
    current = ''
    for (const piece of splitOversized(p, maxChars)) push(piece, ' ')
    if (current !== '') chunks.push(current)
    current = ''
  }
  if (current !== '') chunks.push(current)
  return chunks
}

/** Parte un párrafo en piezas <= maxChars: por frases y, si hace falta, por palabras. */
function splitOversized(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 0)
  const pieces: string[] = []
  for (const s of sentences) {
    if (s.length <= maxChars) pieces.push(s)
    else pieces.push(...splitByWords(s, maxChars))
  }
  return pieces
}

function splitByWords(sentence: string, maxChars: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of sentence.split(/\s+/)) {
    if (w.length > maxChars) {
      if (cur !== '') out.push(cur)
      cur = ''
      for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars))
    } else if (cur === '') {
      cur = w
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w
    } else {
      out.push(cur)
      cur = w
    }
  }
  if (cur !== '') out.push(cur)
  return out
}
