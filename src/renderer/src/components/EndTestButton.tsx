import { useEffect, useRef, useState } from 'react'
import { modeText, type QuizMode } from '../quizMode'

interface Props {
  mode?: QuizMode
  disabled: boolean
  onConfirm(): void
}

/** "Terminar el test aquí" en dos pasos dentro de la propia página (sin diálogo): botón → "¿Seguro? Confirmar" / "No, seguir". */
export function EndTestButton({ mode = 'test', disabled, onConfirm }: Props) {
  const text = modeText(mode)
  const [confirming, setConfirming] = useState(false)
  const start = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const moved = useRef(false)

  // El botón pulsado desaparece al pasar de paso: el foco va al nuevo control para no perderse.
  useEffect(() => {
    if (confirming) confirm.current?.focus()
    else if (moved.current) start.current?.focus()
    moved.current = true
  }, [confirming])

  if (!confirming) {
    return (
      <button ref={start} type="button" className="btn" disabled={disabled} onClick={() => setConfirming(true)}>
        {text.endLabel}
      </button>
    )
  }
  return (
    <div className="row" role="group" aria-label={text.endGroup}>
      <span>{text.endExplain}</span>
      <button ref={confirm} type="button" className="btn btn--danger" disabled={disabled} onClick={onConfirm}>
        ¿Seguro? Confirmar
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => setConfirming(false)}>
        No, seguir
      </button>
    </div>
  )
}
