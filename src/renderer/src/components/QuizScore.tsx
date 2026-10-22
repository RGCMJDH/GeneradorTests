import { useEffect, useRef } from 'react'

interface Props {
  correct: number
  /** Preguntas respondidas (las saltadas o sin responder no cuentan). */
  total: number
  /** Preguntas del test que quedaron sin responder. */
  unanswered?: number
  onRepeat(): void
  onHistory(): void
}

/** Nota final del intento y los siguientes pasos. */
export function QuizScore({ correct, total, unanswered = 0, onRepeat, onHistory }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section className="card" aria-labelledby="quiz-score-title">
      <h3 id="quiz-score-title" ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        Test terminado
      </h3>
      <p className="score">
        {correct} de {total}
        {unanswered > 0 && ' respondidas'}
      </p>
      {unanswered > 0 && <p className="muted">{unanswered === 1 ? '1 pregunta sin responder' : `${unanswered} preguntas sin responder`}.</p>}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={onRepeat}>
          Repetir con otras preguntas
        </button>
        <button type="button" className="btn" onClick={onHistory}>
          Ver historial
        </button>
      </div>
    </section>
  )
}
