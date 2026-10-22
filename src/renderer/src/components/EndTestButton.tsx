import { useEffect, useRef, useState } from 'react'

interface Props {
  disabled: boolean
  onConfirm(): void
}

/** "Terminar el test aquí" en dos pasos dentro de la propia página (sin diálogo): botón → "¿Seguro? Confirmar" / "No, seguir". */
export function EndTestButton({ disabled, onConfirm }: Props) {
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
        Terminar el test aquí
      </button>
    )
  }
  return (
    <div className="row" role="group" aria-label="Confirmar el final del test">
      <span>Se terminará el test y solo contarán las preguntas respondidas hasta ahora.</span>
      <button ref={confirm} type="button" className="btn btn--danger" disabled={disabled} onClick={onConfirm}>
        ¿Seguro? Confirmar
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={() => setConfirming(false)}>
        No, seguir
      </button>
    </div>
  )
}
