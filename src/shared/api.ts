// Contrato único entre main, preload y renderer. SIN imports de Node ni de Electron:
// el renderer lo importa. Solo `import type` hacia core (se borra al compilar).
import type { Chunk, Concept, Question, QuestionType, Subject } from '../core/types'

export type { Chunk, Concept, Question, QuestionType, Subject }

/** Canales de petición/respuesta (ipcRenderer.invoke ↔ ipcMain.handle). Fuente única de nombres. */
export const channels = {
  subjectsList: 'subjects:list',
  subjectsCreate: 'subjects:create',
  notesImport: 'notes:import',
  notesConfirmOcr: 'notes:confirmOcr',
  notesList: 'notes:list',
  notesChunks: 'notes:chunks',
  notesChunk: 'notes:chunk',
  notesDeleteDocument: 'notes:deleteDocument',
  quizGenerate: 'quiz:generate',
  quizCancel: 'quiz:cancel',
  quizStartAttempt: 'quiz:startAttempt',
  quizFinishAttempt: 'quiz:finishAttempt',
  quizSubmit: 'quiz:submit',
  historyList: 'history:list',
  conceptsList: 'concepts:list',
  conceptsBuild: 'concepts:build',
  conceptsCancel: 'concepts:cancel',
  mobileStart: 'mobile:start',
  mobileStop: 'mobile:stop',
  systemHealth: 'system:health',
  systemConfig: 'system:config'
} as const

/** Canales de eventos main → renderer (webContents.send). No tienen handler. */
export const events = {
  quizProgress: 'quiz:progress',
  conceptsProgress: 'concepts:progress',
  /** Una foto llegó desde el móvil (ya procesada con OCR, o con el error). */
  mobileImage: 'mobile:image',
  /** La sesión de subida desde el móvil se apagó sola (caducó). */
  mobileStopped: 'mobile:stopped'
} as const

export type ChannelName = (typeof channels)[keyof typeof channels]

// ------------------------------------------------------------------ resultados

export type ErrorCode =
  | 'INVALID' // payload mal formado
  | 'NOT_FOUND'
  | 'NO_TEXT' // PDF sin texto: la UI puede ofrecer OCR
  | 'WOULD_DELETE_QUESTIONS' // confirmOcr borraría preguntas guardadas; repetir con force:true
  | 'MODEL_UNAVAILABLE' // el modelo no respondió en ningún fragmento (Ollama caído o sin modelo)
  | 'STALE' // los apuntes cambiaron mientras se trabajaba; repetir
  | 'INTERNAL'

export type Failure = { ok: false; error: string; code?: ErrorCode; count?: number }
export type Result<T> = { ok: true; data: T } | Failure

// ------------------------------------------------------------------------ DTOs

export type ImportKind = 'text' | 'pdf' | 'image'

export interface DocumentInfo {
  id: number
  subjectId: number
  title: string
  sourceType: ImportKind
  chunkCount: number
}

export type ImportOutcome =
  | { canceled: true }
  | { canceled: false; kind: 'text' | 'pdf'; document: DocumentInfo; warning?: string }
  | { canceled: false; kind: 'image'; documentId: number; ocrText: string }

export interface ConfirmOcrOutcome {
  documentId: number
  chunkCount: number
  /** Preguntas guardadas que se borraron al reemplazar los fragmentos (solo con force:true). */
  deletedQuestions: number
}

export interface ChunkView {
  id: number
  documentId: number
  documentTitle: string
  position: number
  text: string
}

export interface GenerateRequestDto {
  /** Lo elige el renderer; sirve para cancelar y para filtrar eventos de progreso. */
  requestId: string
  subjectId: number
  type: QuestionType
  count: number
  documentId?: number
  topic?: string
}

export interface GenerateOutcome {
  questions: Question[]
  discarded: number
  reasons: string[]
  insufficient: boolean
}

export interface ProgressEvent {
  requestId: string
  done: number
  total: number
}

export interface ConceptsBuildRequest {
  /** Lo elige el renderer; sirve para cancelar y para filtrar eventos de progreso. */
  requestId: string
  subjectId: number
  /** Solo analiza ese documento; el resultado se MEZCLA con el índice guardado (los demás documentos no se tocan). */
  documentId?: number
}

export interface ConceptsOutcome {
  /** El índice de la asignatura tras la extracción (con documentId, ya mezclado). Si se canceló: lo parcial, que NO se guardó. */
  concepts: Concept[]
  /** true si se canceló: el índice anterior se conserva. */
  cancelled: boolean
  /** Fragmentos analizados / fragmentos disponibles (hay un tope por ejecución, repartido entre documentos). */
  analyzed: number
  total: number
  /** De los analizados, los que fallaron (el modelo lanzó un error o respondió mal). */
  failed: number
}

export interface MobileStartRequest {
  subjectId: number
}

/** Sesión de subida desde el móvil. `qrDataUrl` es un PNG `data:` generado en main; `url` se muestra como texto plano. */
export interface MobileSession {
  url: string
  qrDataUrl: string
  /** Epoch ms en que la sesión se apaga sola. */
  expiresAt: number
}

/** Foto recibida del móvil: el texto OCR queda pendiente de revisión (igual que una foto importada en el PC). */
export type MobileImageEvent = { subjectId: number; documentId: number; ocrText: string } | { subjectId: number; error: string }

export interface MobileStoppedEvent {
  reason: 'expired'
}

export interface SubmitRequest {
  subjectId: number
  attemptId: number
  questionId: number
  answer: string
}

/** `feedback` es texto plano; `verified` se refiere solo a `quote`. */
export interface GradeResultDto {
  correct: boolean
  feedback: string
  quote: string
  verified: boolean
}

export interface HistoryAnswer {
  questionId: number
  prompt: string
  type: QuestionType
  userAnswer: string
  correct: boolean
  feedback: string
  feedbackQuote: string
}

export interface HistoryAttempt {
  id: number
  startedAt: string
  finishedAt: string | null
  answers: HistoryAnswer[]
}

export interface HealthDto {
  ok: boolean
  message: string
  model: string
}

export interface ConfigDto {
  model: string
}

// -------------------------------------------------------------------- window.api

export interface Api {
  subjects: {
    list(): Promise<Result<Subject[]>>
    create(name: string): Promise<Result<Subject>>
  }
  notes: {
    /** Abre el diálogo nativo en main; el renderer nunca pasa rutas. */
    import(subjectId: number, kind: ImportKind): Promise<Result<ImportOutcome>>
    confirmOcr(documentId: number, correctedText: string, force?: boolean): Promise<Result<ConfirmOcrOutcome>>
    list(subjectId: number): Promise<Result<DocumentInfo[]>>
    chunks(subjectId: number, documentId?: number): Promise<Result<Chunk[]>>
    chunk(subjectId: number, chunkId: number): Promise<Result<ChunkView>>
    deleteDocument(subjectId: number, documentId: number): Promise<Result<null>>
  }
  quiz: {
    generate(req: GenerateRequestDto): Promise<Result<GenerateOutcome>>
    cancel(requestId: string): Promise<Result<{ cancelled: boolean }>>
    /** Devuelve la función para cancelar la suscripción. */
    onProgress(cb: (e: ProgressEvent) => void): () => void
    startAttempt(subjectId: number): Promise<Result<{ attemptId: number }>>
    finishAttempt(subjectId: number, attemptId: number): Promise<Result<null>>
    submit(req: SubmitRequest): Promise<Result<GradeResultDto>>
  }
  history: {
    list(subjectId: number): Promise<Result<HistoryAttempt[]>>
  }
  concepts: {
    /** Índice guardado (validado contra los fragmentos actuales). */
    list(subjectId: number): Promise<Result<Concept[]>>
    build(req: ConceptsBuildRequest): Promise<Result<ConceptsOutcome>>
    cancel(requestId: string): Promise<Result<{ cancelled: boolean }>>
    /** Devuelve la función para cancelar la suscripción. */
    onProgress(cb: (e: ProgressEvent) => void): () => void
  }
  mobile: {
    /** Arranca (o devuelve) la subida desde el móvil para esa asignatura. Solo hay una sesión en toda la app. */
    start(req: MobileStartRequest): Promise<Result<MobileSession>>
    stop(): Promise<Result<null>>
    /** Devuelven la función para cancelar la suscripción. */
    onImage(cb: (e: MobileImageEvent) => void): () => void
    onStopped(cb: (e: MobileStoppedEvent) => void): () => void
  }
  system: {
    health(): Promise<Result<HealthDto>>
    config(): Promise<Result<ConfigDto>>
  }
}
