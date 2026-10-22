import { useEffect, useId, useRef, useState } from 'react'
import type { GradeResultDto, Question } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { Correction } from '../components/Correction'
import { EndTestButton } from '../components/EndTestButton'
import { QuestionCard } from '../components/QuestionCard'
import { UNEXPECTED_ERROR } from '../errors'
import { modeText, type QuizMode } from '../quizMode'

export interface Score {
  correct: number
  /** Preguntas respondidas. */
  total: number
  /** Preguntas sin responder (saltadas o no alcanzadas). */
  unanswered: number
}

interface Props {
  mode?: QuizMode
  subjectId: number
  attemptId: number
  /** Solo preguntas con id y cita (las filtra TestTab). */
  questions: Question[]
  onFinished(score: Score): void
}

/** Un intento: una pregunta cada vez, corrección inmediata y, al final, cierre del intento. */
export function QuizRun({ mode = 'test', subjectId, attemptId, questions, onFinished }: Props) {
  const text = modeText(mode)
  const headingId = useId()
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
  // Un test sin al menos 2 opciones no se puede contestar: se avisa y se puede saltar.
  const noOptions = q.type === 'test' && (q.options ?? []).length < 2

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
      const answered = Object.values(results)
      onFinished({ correct: answered.filter((r) => r.correct).length, total: answered.length, unanswered: questions.length - answered.length })
    } catch {
      if (alive.current) setError(UNEXPECTED_ERROR)
    } finally {
      if (alive.current) setFinishing(false)
    }
  }

  /** Una pregunta que no se puede o no se quiere contestar: cuenta como no respondida. La última cierra el intento. */
  function skip(): void {
    if (last) void finish()
    else next()
  }

  function next(): void {
    setAnswer('')
    setError(null)
    setAnnouncement('')
    setIndex((i) => i + 1)
  }

  return (
    <section className="quiz" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>
        {text.itemTitle} {index + 1} de {questions.length}
      </h3>
      <QuestionCard key={qid} question={q} value={answer} onChange={setAnswer} disabled={busy || hasResult || noOptions} />
      {noOptions && <Alert>Esta pregunta no tiene opciones válidas. Puedes saltarla.</Alert>}
      {!hasResult && (
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={busy || noOptions || answer.trim() === ''} onClick={() => void submit()}>
            Responder
          </button>
          <button type="button" className="btn" disabled={busy} onClick={skip}>
            {text.skip}
          </button>
        </div>
      )}
      {submitting && <Busy>{q.type === 'desarrollo' || q.type === 'practico' ? 'Corrigiendo tu respuesta… puede tardar un poco.' : 'Corrigiendo…'}</Busy>}
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
      {!(hasResult && last) && (
        <div className="quiz__exit">
          <EndTestButton mode={mode} disabled={busy} onConfirm={() => void finish()} />
        </div>
      )}
      {finishing && <Busy>Guardando el resultado…</Busy>}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}
