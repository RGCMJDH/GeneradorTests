import { useEffect, useRef } from 'react'

interface Props {
  correct: number
  total: number
  onRepeat(): void
  onHistory(): void
}

/** Nota final del intento y los siguientes pasos. */
export function QuizScore({ correct, total, onRepeat, onHistory }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <section className="card" aria-labelledby="quiz-score-title">
      <h3 id="quiz-score-title" ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        Test terminado
      </h3>
      <p className="score">
        {correct} de {total}
      </p>
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
