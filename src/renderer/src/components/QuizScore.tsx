import { useEffect, useId, useRef } from 'react'
import { modeText, type QuizMode } from '../quizMode'

interface Props {
  mode?: QuizMode
  correct: number
  /** Preguntas respondidas (las saltadas o sin responder no cuentan). */
  total: number
  /** Preguntas del test que quedaron sin responder. */
  unanswered?: number
  onRepeat(): void
  onHistory(): void
}

/** Nota final del intento y los siguientes pasos. */
export function QuizScore({ mode = 'test', correct, total, unanswered = 0, onRepeat, onHistory }: Props) {
  const text = modeText(mode)
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section className="card" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        {text.scoreTitle}
      </h3>
      <p className="score">
        {correct} de {total}
        {unanswered > 0 && ' respondidas'}
      </p>
      {unanswered > 0 && <p className="muted">{text.unanswered(unanswered)}.</p>}
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={onRepeat}>
          {text.repeat}
        </button>
        <button type="button" className="btn" onClick={onHistory}>
          Ver historial
        </button>
      </div>
    </section>
  )
}
