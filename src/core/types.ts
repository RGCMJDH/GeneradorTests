export type QuestionType = 'vf' | 'test' | 'desarrollo' | 'practico'

export interface Subject {
  id: number
  name: string
  createdAt?: string
}

export interface Doc {
  id: number
  subjectId: number
  title: string
  sourceType: 'text' | 'pdf' | 'image'
  path?: string
}

export interface Chunk {
  id: number
  documentId: number
  subjectId: number
  position: number
  text: string
}

export interface Question {
  id?: number
  subjectId: number
  chunkId: number
  type: QuestionType
  prompt: string
  options?: string[]
  answer: string
  explanation: string
  quote: string
}

/** Concepto clave de una asignatura: aparece literalmente en cada uno de sus fragmentos (`chunkIds`). */
export interface Concept {
  term: string
  chunkIds: number[]
  /** Otros conceptos que coinciden con este en al menos un fragmento (calculado, no dicho por el modelo). */
  related: string[]
}
