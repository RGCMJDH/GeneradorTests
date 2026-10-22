import { useId } from 'react'
import type { Question } from '../../../shared/api'

export const MAX_ANSWER_CHARS = 20_000

interface Props {
  question: Question
  value: string
  onChange(value: string): void
  disabled: boolean
}

const VF_OPTIONS = [
  { value: 'verdadero', label: 'Verdadero' },
  { value: 'falso', label: 'Falso' }
]

/** Enunciado y control de respuesta según el tipo. Todo el texto de la pregunta es texto de React (nunca HTML). */
export function QuestionCard({ question, value, onChange, disabled }: Props) {
  const name = useId()
  const textId = useId()
  if (question.type === 'vf' || question.type === 'test') {
    const options = question.type === 'vf' ? VF_OPTIONS : (question.options ?? []).map((o) => ({ value: o, label: o }))
    return (
      <fieldset className="question" disabled={disabled}>
        <legend className="question__prompt">{question.prompt}</legend>
        {options.map((o) => (
          <label key={o.value} className="option">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  return (
    <div className="question">
      <label htmlFor={textId} className="question__prompt">
        {question.prompt}
      </label>
      <textarea
        id={textId}
        rows={8}
        maxLength={MAX_ANSWER_CHARS}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Escribe tu respuesta con tus propias palabras…"
      />
    </div>
  )
}
