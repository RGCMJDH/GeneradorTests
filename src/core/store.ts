import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Chunk, Doc, Question, Subject } from './types'

export interface AnswerRecord {
  id: number
  attemptId: number
  questionId: number
  userAnswer: string
  correct: boolean
  feedback: string
  feedbackQuote: string
}

export interface Attempt {
  id: number
  subjectId: number
  startedAt: string
  finishedAt: string | null
  answers: AnswerRecord[]
}

export type NewAnswer = Omit<AnswerRecord, 'id'>

export interface Store {
  createSubject(name: string): Subject
  listSubjects(): Subject[]
  addDocument(d: { subjectId: number; title: string; sourceType: Doc['sourceType']; path?: string }): Doc
  addChunks(documentId: number, subjectId: number, texts: string[]): Chunk[]
  listChunks(subjectId: number, documentId?: number): Chunk[]
  getChunk(id: number): Chunk | undefined
  updateChunkText(id: number, text: string): void
  deleteDocument(id: number): void
  saveQuestion(q: Question): Question
  listQuestions(subjectId: number): Question[]
  startAttempt(subjectId: number): number
  saveAnswer(a: NewAnswer): void
  finishAttempt(id: number): void
  listAttempts(subjectId: number): Attempt[]
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT,
  answer TEXT NOT NULL,
  explanation TEXT NOT NULL,
  quote TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  feedback TEXT NOT NULL,
  feedback_quote TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_subject ON chunks(subject_id, document_id, position);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chunk ON questions(chunk_id);
`

type Row = Record<string, SqlValue>

function defaultWasmDir(): string {
  // Node / tests: carpeta dist de sql.js. En Electron empaquetado se pasa opts.wasmDir.
  return dirname(createRequire(import.meta.url).resolve('sql.js'))
}

export async function openStore(filePath?: string, opts?: { wasmDir?: string }): Promise<Store> {
  const wasmDir = opts?.wasmDir ?? defaultWasmDir()
  const SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) })
  const db: Database = new SQL.Database(
    filePath && existsSync(filePath) ? readFileSync(filePath) : undefined
  )
  db.run('PRAGMA foreign_keys = ON')
  db.run(SCHEMA)

  const persist = (): void => {
    if (!filePath) return
    const bytes = db.export() // export() puede reiniciar los PRAGMA de la conexión
    db.run('PRAGMA foreign_keys = ON')
    const tmp = `${filePath}.tmp`
    writeFileSync(tmp, bytes)
    renameSync(tmp, filePath)
  }

  const query = (sql: string, params: SqlValue[] = []): Row[] => {
    const stmt = db.prepare(sql)
    try {
      stmt.bind(params)
      const rows: Row[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      return rows
    } finally {
      stmt.free()
    }
  }

  /** Ejecuta una escritura parametrizada, persiste y devuelve el rowid insertado. */
  const write = (sql: string, params: SqlValue[] = []): number => {
    db.run(sql, params)
    const id = query('SELECT last_insert_rowid() AS id')[0].id as number
    persist()
    return id
  }

  const toSubject = (r: Row): Subject => ({ id: r.id as number, name: r.name as string, createdAt: r.created_at as string })
  const toChunk = (r: Row): Chunk => ({
    id: r.id as number, documentId: r.document_id as number, subjectId: r.subject_id as number,
    position: r.position as number, text: r.text as string
  })
  const toQuestion = (r: Row): Question => ({
    id: r.id as number,
    subjectId: r.subject_id as number,
    chunkId: r.chunk_id as number,
    type: r.type as Question['type'],
    prompt: r.prompt as string,
    ...(r.options_json != null ? { options: JSON.parse(r.options_json as string) as string[] } : {}),
    answer: r.answer as string, explanation: r.explanation as string, quote: r.quote as string
  })
  const toAnswer = (r: Row): AnswerRecord => ({
    id: r.id as number,
    attemptId: r.attempt_id as number,
    questionId: r.question_id as number,
    userAnswer: r.user_answer as string,
    correct: r.correct === 1,
    feedback: r.feedback as string,
    feedbackQuote: r.feedback_quote as string
  })

  return {
    createSubject(name) {
      const id = write('INSERT INTO subjects (name) VALUES (?)', [name])
      return toSubject(query('SELECT * FROM subjects WHERE id = ?', [id])[0])
    },
    listSubjects: () => query('SELECT * FROM subjects ORDER BY id').map(toSubject),

    addDocument({ subjectId, title, sourceType, path }) {
      const id = write(
        'INSERT INTO documents (subject_id, title, source_type, path) VALUES (?, ?, ?, ?)',
        [subjectId, title, sourceType, path ?? null]
      )
      return { id, subjectId, title, sourceType, ...(path !== undefined ? { path } : {}) }
    },

    addChunks(documentId, subjectId, texts) {
      db.run('BEGIN')
      try {
        const base = (query('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM chunks WHERE document_id = ?', [documentId])[0].p as number)
        const ids = texts.map((text, i) => {
          db.run('INSERT INTO chunks (document_id, subject_id, position, text) VALUES (?, ?, ?, ?)', [
            documentId, subjectId, base + i, text
          ])
          return query('SELECT last_insert_rowid() AS id')[0].id as number
        })
        db.run('COMMIT')
        persist()
        return texts.map((text, i) => ({ id: ids[i], documentId, subjectId, position: base + i, text }))
      } catch (e) {
        db.run('ROLLBACK')
        throw e
      }
    },
    listChunks(subjectId, documentId) {
      const rows =
        documentId === undefined
          ? query('SELECT * FROM chunks WHERE subject_id = ? ORDER BY document_id, position', [subjectId])
          : query('SELECT * FROM chunks WHERE subject_id = ? AND document_id = ? ORDER BY position', [subjectId, documentId])
      return rows.map(toChunk)
    },
    getChunk(id) {
      const r = query('SELECT * FROM chunks WHERE id = ?', [id])[0]
      return r ? toChunk(r) : undefined
    },
    updateChunkText(id, text) {
      write('UPDATE chunks SET text = ? WHERE id = ?', [text, id])
    },
    deleteDocument(id) {
      write('DELETE FROM documents WHERE id = ?', [id]) // chunks y preguntas caen en cascada
    },

    saveQuestion(q) {
      const id = write(
        `INSERT INTO questions (subject_id, chunk_id, type, prompt, options_json, answer, explanation, quote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [q.subjectId, q.chunkId, q.type, q.prompt, q.options ? JSON.stringify(q.options) : null, q.answer, q.explanation, q.quote]
      )
      return { ...q, id }
    },
    listQuestions: (subjectId) =>
      query('SELECT * FROM questions WHERE subject_id = ? ORDER BY id', [subjectId]).map(toQuestion),

    startAttempt: (subjectId) => write('INSERT INTO attempts (subject_id) VALUES (?)', [subjectId]),
    saveAnswer(a) {
      write(
        `INSERT INTO answers (attempt_id, question_id, user_answer, correct, feedback, feedback_quote)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [a.attemptId, a.questionId, a.userAnswer, a.correct ? 1 : 0, a.feedback, a.feedbackQuote]
      )
    },
    finishAttempt(id) {
      write('UPDATE attempts SET finished_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
    },
    listAttempts(subjectId) {
      return query('SELECT * FROM attempts WHERE subject_id = ? ORDER BY id', [subjectId]).map((r) => ({
        id: r.id as number,
        subjectId: r.subject_id as number,
        startedAt: r.started_at as string,
        finishedAt: (r.finished_at as string | null) ?? null,
        answers: query('SELECT * FROM answers WHERE attempt_id = ? ORDER BY id', [r.id as number]).map(toAnswer)
      }))
    }
  }
}
