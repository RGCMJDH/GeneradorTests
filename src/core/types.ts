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
