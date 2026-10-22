import { useId, useState } from 'react'
import type { HistoryAttempt } from '../../../shared/api'
import { Correction } from './Correction'

const TYPE_LABEL: Record<string, string> = { vf: 'Verdadero/Falso', test: 'Tipo test', desarrollo: 'Desarrollar', practico: 'Ejercicio práctico' }

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Un intento del historial: cabecera con nota y detalle desplegable por pregunta. */
export function HistoryAttemptItem({ attempt }: { attempt: HistoryAttempt }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const total = attempt.answers.length
  const correct = attempt.answers.filter((a) => a.correct).length
  return (
    <li className="attempt">
      <button type="button" className="attempt__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className="attempt__date">{formatDate(attempt.startedAt)}</span>
        <span className="attempt__score">
          {correct}/{total}
        </span>
        <span className="muted">{total === 1 ? '1 pregunta' : `${total} preguntas`}</span>
        {attempt.finishedAt === null && <span className="tag">Sin terminar</span>}
      </button>
      <div id={panelId} hidden={!open} className="attempt__body">
        {total === 0 ? (
          <p className="muted">Este intento no tiene respuestas.</p>
        ) : (
          <ol className="attempt__answers">
            {attempt.answers.map((a, i) => (
              <li key={a.questionId} className="attempt__answer">
                <p className="muted attempt__type">
                  Pregunta {i + 1} · {TYPE_LABEL[a.type] ?? a.type}
                </p>
                <p className="attempt__prompt">{a.prompt || 'La pregunta ya no está disponible.'}</p>
                <p>
                  <span className="muted">Tu respuesta: </span>
                  <span className="attempt__user">{a.userAnswer || '(sin respuesta)'}</span>
                </p>
                {/* El historial no guarda el fragmento ni si la cita se verificó: no se afirma nada ni se ofrece enlace. */}
                <Correction correct={a.correct} feedback={a.feedback} quote={a.feedbackQuote} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  )
}
