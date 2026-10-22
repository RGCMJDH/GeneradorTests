import { useEffect, useId, useRef } from 'react'
import { modeText, type QuizMode } from '../quizMode'

export interface Summary {
  /** Preguntas mostrables (con id y cita). */
  count: number
  discarded: number
  reasons: string[]
  insufficient: boolean
  cancelled: boolean
}

interface Props {
  mode?: QuizMode
  summary: Summary
  starting: boolean
  onStart(): void
  onBack(): void
}

/** Resultado honesto de la generación: lo que hay, lo que se descartó y por qué. Todo es texto plano. */
export function GenerationSummary({ mode = 'test', summary, starting, onStart, onBack }: Props) {
  const text = modeText(mode)
  const titleId = useId()
  const { count, discarded, reasons, insufficient, cancelled } = summary
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section className="card" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        Resultado de la generación
      </h3>
      {cancelled && (
        <p className="notice" role="status">
          Generación cancelada. {count > 0 ? text.kept(count) : text.noneYet}
        </p>
      )}
      {count > 0 && !cancelled && <p>{text.generated(count)}</p>}
      {insufficient && count === 0 && (
        <p className="notice" role="status">
          {text.insufficient}
        </p>
      )}
      {count === 0 && discarded === 0 && !insufficient && !cancelled && <p>{text.nothingGenerated}</p>}
      {discarded > 0 && (
        <div className="notice" role="status">
          <p>{text.discarded(discarded)}</p>
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
            {text.start}
          </button>
        )}
        <button type="button" className="btn" disabled={starting} onClick={onBack}>
          {count > 0 ? text.another : 'Volver al formulario'}
        </button>
      </div>
    </section>
  )
}
