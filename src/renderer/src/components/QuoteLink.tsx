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
}

/**
 * Bloque "Fragmento de origen". La insignia de verificación vive SOLO aquí y se refiere únicamente a la cita:
 * no dice que el veredicto o el feedback sean correctos. Todo el texto se pinta como nodo de texto de React.
 */
export function QuoteLink({ quote, verified, chunkId }: Props) {
  const { focusChunk } = useChunkFocus()
  const text = quote.trim()
  // Sin cita, sin enlace y sin nada que decir de la verificación: no hay bloque.
  if (!text && chunkId === undefined && verified !== false) return null
  return (
    <aside className="quote" aria-label="Fragmento de origen">
      <p className="quote__label">Fragmento de origen</p>
      {text && <blockquote className="quote__text">{quote}</blockquote>}
      {verified === true && text && <p className="badge badge--ok">Cita verificada en tus apuntes</p>}
      {verified === false && <p className="badge badge--warn">No se pudo verificar la cita</p>}
      <p className="quote__hint muted">Es el pasaje de tus apuntes en el que se apoya la pregunta; por sí sola no garantiza que la corrección sea acertada.</p>
      {chunkId !== undefined && (
        <button type="button" className="btn btn--small" onClick={() => focusChunk(chunkId)}>
          Ver en apuntes
        </button>
      )}
    </aside>
  )
}
