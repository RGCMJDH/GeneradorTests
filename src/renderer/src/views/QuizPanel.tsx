import { useEffect, useRef, useState } from 'react'
import type { GenerateOutcome, Question } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { GenerateForm, type GenerateParams } from '../components/GenerateForm'
import { GenerationProgress } from '../components/GenerationProgress'
import { GenerationSummary, type Summary } from '../components/GenerationSummary'
import { QuizScore } from '../components/QuizScore'
import { UNEXPECTED_ERROR } from '../errors'
import { modeText, type QuizMode } from '../quizMode'
import { newRequestId } from '../requestId'
import { QuizRun, type Score } from './QuizRun'
import type { Blocking, TabProps } from './types'

interface Props extends TabProps {
  /** 'test' (por defecto) o 'exercises': ejercicios prácticos, con el tipo fijado y su propio vocabulario. */
  mode?: QuizMode
  /** La pestaña está visible (el formulario recarga los documentos al mostrarse). */
  active?: boolean
  /** Avisa de que hay una generación o un intento en curso que se perdería al cambiar de asignatura. */
  onBlockingChange?(blocking: Blocking): void
  onShowHistory?(): void
}

type Phase =
  | { kind: 'form' }
  | { kind: 'generating'; requestId: string; done: number; total: number; cancelling: boolean }
  | { kind: 'summary'; questions: Question[]; summary: Summary }
  | { kind: 'taking'; questions: Question[]; attemptId: number }
  | { kind: 'done'; score: Score }

interface Job {
  requestId: string
  cancelRequested: boolean
  off(): void
}

/** Nunca se muestra una pregunta sin id guardado ni sin cita. */
const showable = (q: Question): boolean => q.id !== undefined && q.quote.trim() !== ''

function summarize(out: GenerateOutcome, cancelled: boolean, mode: QuizMode): { questions: Question[]; summary: Summary } {
  const questions = out.questions.filter(showable)
  const hidden = out.questions.length - questions.length
  const reasons = hidden > 0 ? [...out.reasons, `${hidden} ${modeText(mode).hidden(hidden)}`] : out.reasons
  return { questions, summary: { count: questions.length, discarded: out.discarded + hidden, reasons, insufficient: out.insufficient, cancelled } }
}

/** Generar → resumen → responder una a una con corrección → nota. Lo comparten las pestañas Test y Ejercicios. */
export default function QuizPanel({ subject, mode = 'test', active = true, onBlockingChange, onShowHistory }: Props) {
  const text = modeText(mode)
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // Al volver al formulario desde otra fase, el foco va a su primer control (el botón que lo tenía ya no existe).
  const [returned, setReturned] = useState(false)
  const alive = useRef(true)
  const running = useRef<Job | null>(null)
  const sid = subject.id

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // Al desmontar (p. ej. cambio de asignatura) se cancela lo que siga generándose.
      const job = running.current
      if (job) {
        job.off()
        void Promise.resolve(window.api.quiz.cancel(job.requestId)).catch(() => {})
      }
    }
  }, [])

  const blocking: Blocking = phase.kind === 'generating' ? 'generating' : phase.kind === 'taking' ? 'quiz' : null
  useEffect(() => {
    onBlockingChange?.(blocking)
  }, [blocking, onBlockingChange])
  useEffect(() => () => onBlockingChange?.(null), [onBlockingChange])

  /** Con Ollama caído el fallo suele ser suyo: se muestra primero el diagnóstico. */
  async function failureMessage(message: string): Promise<string> {
    try {
      const h = await window.api.system.health()
      if (h.ok && !h.data.ok) return `${h.data.message} ${message}`
    } catch {
      /* sin diagnóstico: solo el error original */
    }
    return message
  }

  async function generate(p: GenerateParams): Promise<void> {
    const requestId = newRequestId()
    setError(null)
    setPhase({ kind: 'generating', requestId, done: 0, total: p.count, cancelling: false })
    const off = window.api.quiz.onProgress((e) => {
      if (e.requestId !== requestId || !alive.current) return
      setPhase((cur) => (cur.kind === 'generating' && cur.requestId === requestId ? { ...cur, done: e.done, total: e.total } : cur))
    })
    const job: Job = { requestId, cancelRequested: false, off }
    running.current = job
    try {
      const res = await window.api.quiz.generate({ requestId, subjectId: sid, ...p })
      if (!alive.current) return
      if (!res.ok) {
        setError(await failureMessage(res.error))
        setReturned(true)
        return setPhase({ kind: 'form' })
      }
      setError(null) // p. ej. un fallo de cancelación anterior: ya no aplica
      setPhase({ kind: 'summary', ...summarize(res.data, job.cancelRequested, mode) })
    } catch {
      if (!alive.current) return
      setError(await failureMessage(UNEXPECTED_ERROR))
      setReturned(true)
      setPhase({ kind: 'form' })
    } finally {
      off()
      if (running.current === job) running.current = null
    }
  }

  async function cancel(): Promise<void> {
    const job = running.current
    if (!job) return
    job.cancelRequested = true
    setPhase((cur) => (cur.kind === 'generating' ? { ...cur, cancelling: true } : cur))
    try {
      const res = await window.api.quiz.cancel(job.requestId)
      if (!alive.current) return
      if (res.ok) {
        // Si ya había terminado, no hubo cancelación real: no se presenta como cancelada.
        if (!res.data.cancelled) job.cancelRequested = false
        return
      }
      setError(res.error)
    } catch {
      if (!alive.current) return
      setError(UNEXPECTED_ERROR)
    }
    // La cancelación falló: la generación sigue y se puede volver a intentar.
    job.cancelRequested = false
    setPhase((cur) => (cur.kind === 'generating' ? { ...cur, cancelling: false } : cur))
  }

  async function startAttempt(questions: Question[]): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      const res = await window.api.quiz.startAttempt(sid)
      if (!alive.current) return
      if (!res.ok) return setError(res.error)
      setPhase({ kind: 'taking', questions, attemptId: res.data.attemptId })
    } catch {
      if (alive.current) setError(UNEXPECTED_ERROR)
    } finally {
      if (alive.current) setStarting(false)
    }
  }

  const reset = (): void => {
    setError(null)
    setReturned(true)
    setPhase({ kind: 'form' })
  }

  return (
    <div className="testtab">
      <Alert>{error}</Alert>
      {phase.kind === 'form' && <GenerateForm mode={mode} subjectId={sid} active={active} focusFirst={returned} onGenerate={(p) => void generate(p)} />}
      {phase.kind === 'generating' && <GenerationProgress mode={mode} done={phase.done} total={phase.total} cancelling={phase.cancelling} onCancel={() => void cancel()} />}
      {phase.kind === 'summary' && (
        <>
          <GenerationSummary mode={mode} summary={phase.summary} starting={starting} onStart={() => void startAttempt(phase.questions)} onBack={reset} />
          {starting && <Busy>{text.preparing}</Busy>}
        </>
      )}
      {phase.kind === 'taking' && <QuizRun mode={mode} subjectId={sid} attemptId={phase.attemptId} questions={phase.questions} onFinished={(score) => setPhase({ kind: 'done', score })} />}
      {phase.kind === 'done' && <QuizScore mode={mode} correct={phase.score.correct} total={phase.score.total} unanswered={phase.score.unanswered} onRepeat={reset} onHistory={() => onShowHistory?.()} />}
    </div>
  )
}
