import type { GenerateRequest } from '@core/generate'
import type { QuestionType } from '@core/types'
import { channels, events, type GenerateOutcome, type GradeResultDto, type HistoryAttempt, type ProgressEvent } from '../../shared/api'
import { handle, invalid, notFound, trySend } from './common'
import type { IpcContext, Registrar } from './context'
import { requireSubject } from './subjects'
import { arity, id, MAX_ANSWER, MAX_TOPIC, oneOf, optId, record, requestId, str } from './validate'

const TYPES: readonly QuestionType[] = ['vf', 'test', 'desarrollo', 'practico']
const GENERATE_KEYS = ['requestId', 'subjectId', 'type', 'count', 'documentId', 'topic'] as const
const SUBMIT_KEYS = ['subjectId', 'attemptId', 'questionId', 'answer'] as const

export function registerQuiz(ctx: IpcContext, r: Registrar): void {
  const { store } = ctx
  /** Generaciones en curso, por requestId del renderer. */
  const running = new Map<string, AbortController>()
  /** Correcciones en vuelo ("attempt:question"): evita guardar dos veces la misma respuesta. */
  const grading = new Set<string>()

  const attemptOf = (subjectId: number, attemptId: number) => {
    const a = store.listAttempts(subjectId).find((x) => x.id === attemptId)
    if (!a) throw notFound('El intento no existe en esta asignatura.')
    return a
  }

  handle(r, channels.quizGenerate, async (event, args): Promise<GenerateOutcome> => {
    arity(args, 1)
    const p = record(args[0], GENERATE_KEYS, 'La solicitud')
    const reqId = requestId(p.requestId)
    const count = p.count
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw invalid('count debe ser un entero positivo.')
    const req: GenerateRequest = {
      subjectId: id(p.subjectId, 'subjectId'),
      type: oneOf(p.type, TYPES, 'El tipo de pregunta'),
      count,
      ...(p.documentId !== undefined ? { documentId: optId(p.documentId, 'documentId') } : {}),
      ...(p.topic !== undefined ? { topic: str(p.topic, 'El tema', MAX_TOPIC, { allowEmpty: true }) } : {})
    }
    if (running.has(reqId)) throw invalid('Ya hay una generación en curso con ese requestId.')

    const controller = new AbortController()
    running.set(reqId, controller)
    try {
      const onProgress = (done: number, total: number): void =>
        trySend(event, events.quizProgress, { requestId: reqId, done, total } satisfies ProgressEvent)
      const res = await ctx.core.generateQuestions({ llm: ctx.llm, store }, req, onProgress, controller.signal)
      return { questions: res.questions, discarded: res.discarded, reasons: res.reasons, insufficient: res.insufficient }
    } finally {
      running.delete(reqId)
    }
  })

  handle(r, channels.quizCancel, (_e, args) => {
    arity(args, 1)
    const controller = running.get(requestId(args[0]))
    controller?.abort()
    return { cancelled: controller !== undefined }
  })

  handle(r, channels.quizStartAttempt, (_e, args) => {
    arity(args, 1)
    const subjectId = id(args[0], 'subjectId')
    requireSubject(ctx, subjectId)
    return { attemptId: store.startAttempt(subjectId) }
  })

  handle(r, channels.quizFinishAttempt, (_e, args) => {
    arity(args, 2)
    const attempt = attemptOf(id(args[0], 'subjectId'), id(args[1], 'attemptId'))
    if (attempt.finishedAt === null) store.finishAttempt(attempt.id)
    return null
  })

  handle(r, channels.quizSubmit, async (_e, args): Promise<GradeResultDto> => {
    arity(args, 1)
    const p = record(args[0], SUBMIT_KEYS, 'La respuesta')
    const subjectId = id(p.subjectId, 'subjectId')
    const attemptId = id(p.attemptId, 'attemptId')
    const questionId = id(p.questionId, 'questionId')
    const answer = str(p.answer, 'La respuesta', MAX_ANSWER, { allowEmpty: true })

    const attempt = attemptOf(subjectId, attemptId)
    // La pregunta se carga del store acotada a la asignatura: nunca se confía en datos del renderer.
    const question = store.listQuestions(subjectId).find((q) => q.id === questionId)
    if (!question) throw notFound('La pregunta no existe en esta asignatura.')
    if (attempt.finishedAt !== null) throw invalid('Este intento ya está finalizado.')
    const key = `${attemptId}:${questionId}`
    if (grading.has(key) || attempt.answers.some((a) => a.questionId === questionId))
      throw invalid('Esta pregunta ya está respondida en este intento.')

    grading.add(key)
    try {
      const g = await ctx.core.gradeAnswer({ llm: ctx.llm, store }, question, answer)
      store.saveAnswer({ attemptId, questionId, userAnswer: answer, correct: g.correct, feedback: g.feedback, feedbackQuote: g.quote })
      return { correct: g.correct, feedback: g.feedback, quote: g.quote, verified: g.verified }
    } finally {
      grading.delete(key)
    }
  })

  handle(r, channels.historyList, (_e, args): HistoryAttempt[] => {
    arity(args, 1)
    const subjectId = id(args[0], 'subjectId')
    const questions = new Map(store.listQuestions(subjectId).map((q) => [q.id as number, q]))
    return store.listAttempts(subjectId).map((a) => ({
      id: a.id,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      answers: a.answers.map((x) => ({
        questionId: x.questionId,
        prompt: questions.get(x.questionId)?.prompt ?? '',
        type: questions.get(x.questionId)?.type ?? 'desarrollo',
        userAnswer: x.userAnswer,
        correct: x.correct,
        feedback: x.feedback,
        feedbackQuote: x.feedbackQuote
      }))
    }))
  })
}
