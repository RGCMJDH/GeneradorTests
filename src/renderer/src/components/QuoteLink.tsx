import { useChunkFocus } from '../chunkFocus'

interface Props {
  quote: string
  /**
   * true: la cita se comprobó literalmente contra los apuntes. false: no se pudo comprobar.
   * undefined: la fuente de datos no informa de ello (p. ej. el historial): no se afirma nada.
   */
  verified?: boolean
  /** Fragmento de origen; sin él no se ofrece el enlace "Ver en apuntes". */
  chunkId?: number
  /** La cita verificada es la guardada con la pregunta, pero la que propuso el modelo al corregir no se pudo verificar. */
  modelQuoteUnverified?: boolean
}

/**
 * Bloque "Fragmento de origen". La insignia de verificación y la pista de procedencia viven SOLO aquí y solo con verified===true;
 * se refieren únicamente a la cita (al fragmento), no dicen que el veredicto o el feedback sean correctos.
 * Todo el texto se pinta como nodo de texto de React. Sin cita no se pinta nada.
 */
export function QuoteLink({ quote, verified, chunkId, modelQuoteUnverified = false }: Props) {
  const { focusChunk } = useChunkFocus()
  if (!quote.trim()) return null
  return (
    <aside className="quote" aria-label="Fragmento de origen">
      <p className="quote__label">Fragmento de origen</p>
      <blockquote className="quote__text">{quote}</blockquote>
      {verified === true && <p className="badge badge--ok">Cita verificada en tus apuntes</p>}
      {verified === false && <p className="badge badge--warn">No se pudo verificar la cita</p>}
      {verified === true && modelQuoteUnverified && (
        <p className="quote__hint">Esta cita es la guardada con la pregunta; la cita que propuso el modelo no se pudo verificar.</p>
      )}
      {verified === true && (
        <p className="quote__hint muted">Es el pasaje de tus apuntes en el que se apoya la pregunta; por sí sola no garantiza que la corrección sea acertada.</p>
      )}
      {verified === undefined && <p className="quote__hint muted">Cita guardada con la pregunta; no se ha comprobado ahora.</p>}
      {chunkId !== undefined && (
        <button type="button" className="btn btn--small" onClick={() => focusChunk(chunkId)}>
          Ver en apuntes
        </button>
      )}
    </aside>
  )
}
