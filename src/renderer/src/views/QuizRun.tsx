import { useEffect, useRef, useState } from 'react'
import type { GradeResultDto, Question } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { Correction } from '../components/Correction'
import { QuestionCard } from '../components/QuestionCard'
import { UNEXPECTED_ERROR } from '../errors'

export interface Score {
  correct: number
  total: number
}

interface Props {
  subjectId: number
  attemptId: number
  /** Solo preguntas con id y cita (las filtra TestTab). */
  questions: Question[]
  onFinished(score: Score): void
}

/** Un intento: una pregunta cada vez, corrección inmediata y, al final, cierre del intento. */
export function QuizRun({ subjectId, attemptId, questions, onFinished }: Props) {
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [results, setResults] = useState<Record<number, GradeResultDto>>({})
  const [submitting, setSubmitting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const correction = useRef<HTMLElement>(null)
  const alive = useRef(true)

  const q = questions[index] as Question
  const qid = q.id as number
  const result = results[qid]
  const last = index === questions.length - 1
  const busy = submitting || finishing

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Pregunta nueva → el foco va a su encabezado.
  useEffect(() => {
    heading.current?.focus()
  }, [index])

  // Tras responder → el foco va a la región de corrección.
  const hasResult = result !== undefined
  useEffect(() => {
    if (hasResult) correction.current?.focus()
  }, [hasResult])

  async function submit(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const res = await window.api.quiz.submit({ subjectId, attemptId, questionId: qid, answer })
      if (!alive.current) return
      if (!res.ok) return setError(res.error)
      setResults((prev) => ({ ...prev, [qid]: res.data }))
      setAnnouncement(res.data.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.')
    } catch {
      if (alive.current) setError(UNEXPECTED_ERROR)
    } finally {
      if (alive.current) setSubmitting(false)
    }
  }

  async function finish(): Promise<void> {
    setFinishing(true)
    setError(null)
    try {
      const res = await window.api.quiz.finishAttempt(subjectId, attemptId)
      if (!alive.current) return
      if (!res.ok) return setError(res.error)
      onFinished({ correct: Object.values(results).filter((r) => r.correct).length, total: questions.length })
    } catch {
      if (alive.current) setError(UNEXPECTED_ERROR)
    } finally {
      if (alive.current) setFinishing(false)
    }
  }

  function next(): void {
    setAnswer('')
    setError(null)
    setAnnouncement('')
    setIndex((i) => i + 1)
  }

  return (
    <section className="quiz" aria-labelledby="quiz-heading">
      <h3 id="quiz-heading" ref={heading} tabIndex={-1}>
        Pregunta {index + 1} de {questions.length}
      </h3>
      <QuestionCard key={qid} question={q} value={answer} onChange={setAnswer} disabled={busy || hasResult} />
      {!hasResult && (
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={busy || answer.trim() === ''} onClick={() => void submit()}>
            Responder
          </button>
        </div>
      )}
      {submitting && <Busy>{q.type === 'desarrollo' ? 'Corrigiendo tu respuesta… puede tardar un poco.' : 'Corrigiendo…'}</Busy>}
      <Alert>{error}</Alert>
      {result && (
        <>
          <Correction ref={correction} correct={result.correct} feedback={result.feedback} quote={result.quote} verified={result.verified} chunkId={q.chunkId} />
          <div className="row">
            {last ? (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void finish()}>
                Terminar y ver la nota
              </button>
            ) : (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={next}>
                Siguiente pregunta
              </button>
            )}
          </div>
        </>
      )}
      {finishing && <Busy>Guardando el resultado…</Busy>}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}
