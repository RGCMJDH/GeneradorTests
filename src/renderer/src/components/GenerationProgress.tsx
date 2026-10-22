import { useEffect, useRef } from 'react'
import { Busy } from './Alert'

interface Props {
  done: number
  total: number
  cancelling: boolean
  onCancel(): void
}

/** Barra de progreso (role="progressbar") por pregunta y botón Cancelar. */
export function GenerationProgress({ done, total, cancelling, onCancel }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const max = Math.max(total, 1)
  const value = Math.min(done, max)
  return (
    <div className="card" aria-labelledby="gen-progress-title">
      <h3 id="gen-progress-title" ref={heading} tabIndex={-1} style={{ marginTop: 0 }}>
        Generando preguntas
      </h3>
      <div
        className="progress"
        role="progressbar"
        aria-label="Progreso de la generación"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} de ${max} preguntas`}
      >
        <div className="progress__bar" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <p className="muted">
        {value} de {max} preguntas
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
