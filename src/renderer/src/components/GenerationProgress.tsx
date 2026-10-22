import { useEffect, useId, useRef } from 'react'
import { modeText, type QuizMode } from '../quizMode'
import { Busy } from './Alert'

interface Props {
  mode?: QuizMode
  done: number
  total: number
  cancelling: boolean
  onCancel(): void
}

/** Barra de progreso (role="progressbar") por pregunta y botón Cancelar. */
export function GenerationProgress({ mode = 'test', done, total, cancelling, onCancel }: Props) {
  const text = modeText(mode)
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const max = Math.max(total, 1)
  const value = Math.min(done, max)
  return (
    <div className="card" aria-labelledby={titleId}>
      <h3 id={titleId} ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        {text.progressTitle}
      </h3>
      <div
        className="progress"
        role="progressbar"
        aria-label="Progreso de la generación"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} de ${max} ${text.progressUnit}`}
      >
        <div className="progress__bar" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <p className="muted">
        {value} de {max} {text.progressUnit}
      </p>
      {cancelling ? <Busy>Cancelando… se conservarán las preguntas ya generadas.</Busy> : <Busy>Esto puede tardar varios minutos.</Busy>}
      <div className="row">
        <button type="button" className="btn" disabled={cancelling} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
