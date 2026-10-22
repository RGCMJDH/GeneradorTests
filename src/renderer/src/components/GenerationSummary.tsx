import { useEffect, useRef } from 'react'

export interface Summary {
  /** Preguntas mostrables (con id y cita). */
  count: number
  discarded: number
  reasons: string[]
  insufficient: boolean
  cancelled: boolean
}

interface Props {
  summary: Summary
  starting: boolean
  onStart(): void
  onBack(): void
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Resultado honesto de la generación: lo que hay, lo que se descartó y por qué. Todo es texto plano. */
export function GenerationSummary({ summary, starting, onStart, onBack }: Props) {
  const { count, discarded, reasons, insufficient, cancelled } = summary
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section className="card" aria-labelledby="gen-result-title">
      <h3 id="gen-result-title" ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        Resultado de la generación
      </h3>
      {cancelled && (
        <p className="notice" role="status">
          Generación cancelada.{' '}
          {count > 0 ? `Se conservaron ${plural(count, 'pregunta ya generada', 'preguntas ya generadas')}.` : 'Todavía no se había generado ninguna pregunta.'}
        </p>
      )}
      {count > 0 && !cancelled && <p>{count === 1 ? 'Se generó 1 pregunta con cita de tus apuntes.' : `Se generaron ${count} preguntas, cada una con su cita de tus apuntes.`}</p>}
      {insufficient && count === 0 && (
        <p className="notice" role="status">
          No hay material suficiente en tus apuntes para ese tema
        </p>
      )}
      {count === 0 && discarded === 0 && !insufficient && !cancelled && <p>No se generó ninguna pregunta. Prueba otra vez o cambia el tema.</p>}
      {discarded > 0 && (
        <div className="notice" role="status">
          <p>
            {discarded === 1
              ? 'Se descartó 1 pregunta que no se pudo respaldar con tus apuntes.'
              : `Se descartaron ${discarded} preguntas que no se pudieron respaldar con tus apuntes.`}
          </p>
          {reasons.length > 0 && (
            <ul aria-label="Motivos del descarte">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="row">
        {count > 0 && (
          <button type="button" className="btn btn--primary" disabled={starting} onClick={onStart}>
            Empezar el test
          </button>
        )}
        <button type="button" className="btn" disabled={starting} onClick={onBack}>
          {count > 0 ? 'Generar otras' : 'Volver al formulario'}
        </button>
      </div>
    </section>
  )
}
