import type { Ref } from 'react'
import { QuoteLink } from './QuoteLink'

/** Marcador que añade el corrector cuando la cita propuesta por el modelo no se pudo verificar. */
export const MODEL_QUOTE_MARK = '(cita del modelo no verificada)'

interface Props {
  correct: boolean
  /** Texto plano. Nunca lleva insignia de verificación: esa solo existe en el bloque de la cita. */
  feedback: string
  quote: string
  verified?: boolean
  chunkId?: number
  /** Para mover el foco aquí tras responder. */
  ref?: Ref<HTMLElement>
}

/** Resultado de una respuesta: Correcto/Incorrecto, feedback en texto plano y bloque de la cita. */
export function Correction({ correct, feedback, quote, verified, chunkId, ref }: Props) {
  return (
    <section ref={ref} tabIndex={-1} aria-label="Corrección" className={correct ? 'correction correction--ok' : 'correction correction--bad'}>
      <p className="correction__verdict">{correct ? 'Correcto' : 'Incorrecto'}</p>
      <p className="correction__feedback" data-testid="feedback">
        {feedback}
      </p>
      <QuoteLink quote={quote} verified={verified} chunkId={chunkId} modelQuoteUnverified={feedback.includes(MODEL_QUOTE_MARK)} />
    </section>
  )
}
