import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { DocumentInfo, QuestionType } from '../../../shared/api'
import { UNEXPECTED_ERROR } from '../errors'
import { modeText, type QuizMode } from '../quizMode'
import { Alert } from './Alert'

export const MIN_COUNT = 1
export const MAX_COUNT = 20
export const MAX_TOPIC = 200

export type FormType = Extract<QuestionType, 'vf' | 'test' | 'desarrollo' | 'practico'>

/** Tipos que el usuario puede elegir en el modo test; el modo ejercicios fija 'practico'. */
type ChoosableType = Exclude<FormType, 'practico'>

const TYPES: { value: ChoosableType; label: string }[] = [
  { value: 'vf', label: 'Verdadero/Falso' },
  { value: 'test', label: 'Tipo test' },
  { value: 'desarrollo', label: 'Desarrollar' }
]

export interface GenerateParams {
  type: FormType
  count: number
  documentId?: number
  topic?: string
}

interface Props {
  subjectId: number
  /** 'exercises': el tipo es siempre 'practico' y no se ofrece selector. */
  mode?: QuizMode
  /** La pestaña está visible: se recarga la lista de documentos por si se importó algo en Apuntes. */
  active: boolean
  /** Mueve el foco al primer control al montarse (al volver de otra fase). */
  focusFirst?: boolean
  onGenerate(params: GenerateParams): void
}

/** Formulario de generación: tipo, nº de preguntas (1–20), documento y tema opcionales. */
export function GenerateForm({ subjectId, active, mode = 'test', focusFirst = false, onGenerate }: Props) {
  const text = modeText(mode)
  const exercises = mode === 'exercises'
  // Ids propios: Test y Ejercicios están montados a la vez y no deben compartir ids.
  const uid = useId()
  const countId = `${uid}-count`
  const docId = `${uid}-doc`
  const topicId = `${uid}-topic`
  const conceptsListId = `${uid}-concepts`
  const topicHintId = `${uid}-topic-hint`
  const countErrorId = `${uid}-count-error`
  const firstControl = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<ChoosableType>('vf')
  const type: FormType = exercises ? 'practico' : chosen
  const [countText, setCountText] = useState('5')
  const [documentId, setDocumentId] = useState('')
  const [topic, setTopic] = useState('')
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null)
  const [concepts, setConcepts] = useState<string[]>([])
  const [docsError, setDocsError] = useState<string | null>(null)
  const [countError, setCountError] = useState<string | null>(null)

  useEffect(() => {
    if (focusFirst) firstControl.current?.focus()
  }, [focusFirst])

  useEffect(() => {
    if (!active) return
    let alive = true
    window.api.notes
      .list(subjectId)
      .then((res) => {
        if (!alive) return
        if (res.ok) {
          setDocs(res.data.filter((d) => d.chunkCount > 0))
          setDocsError(null)
        } else setDocsError(res.error)
      })
      .catch(() => alive && setDocsError(UNEXPECTED_ERROR))
    return () => {
      alive = false
    }
  }, [subjectId, active])

  // Sugerencias de tema: conceptos extraídos de los apuntes. Son opcionales: si faltan o fallan, el tema sigue siendo texto libre.
  useEffect(() => {
    if (!active) return
    let alive = true
    window.api.concepts
      .list(subjectId)
      .then((res) => {
        if (alive && res.ok) setConcepts(res.data.map((c) => c.term))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [subjectId, active])

  // Un documento elegido que ya no existe vuelve a "todos".
  const selectedDoc = docs?.find((d) => String(d.id) === documentId)
  const noNotes = docs !== null && docs.length === 0

  function submit(e: FormEvent): void {
    e.preventDefault()
    const trimmed = countText.trim()
    const count = Number(trimmed)
    if (trimmed === '' || !Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
      return setCountError(text.countError(MIN_COUNT, MAX_COUNT))
    }
    setCountError(null)
    const t = topic.trim()
    onGenerate({ type, count, ...(selectedDoc ? { documentId: selectedDoc.id } : {}), ...(t ? { topic: t } : {}) })
  }

  return (
    <form className="card genform" onSubmit={submit} noValidate>
      {!exercises && (
        <fieldset className="genform__types">
          <legend>Tipo de pregunta</legend>
          {TYPES.map((t) => (
            <label key={t.value} className="option">
              <input ref={t.value === chosen ? firstControl : undefined} type="radio" name={`${uid}-type`} value={t.value} checked={chosen === t.value} onChange={() => setChosen(t.value)} />
              <span>{t.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {text.intro && <p className="notice">{text.intro}</p>}

      <div className="genform__field">
        <label htmlFor={countId}>
          {text.countLabel} ({MIN_COUNT}–{MAX_COUNT})
        </label>
        <input
          ref={exercises ? firstControl : undefined}
          id={countId}
          type="number"
          inputMode="numeric"
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={countText}
          aria-invalid={countError ? true : undefined}
          aria-describedby={countError ? countErrorId : undefined}
          onChange={(e) => setCountText(e.target.value)}
        />
        {countError && (
          <div id={countErrorId}>
            <Alert>{countError}</Alert>
          </div>
        )}
      </div>

      <div className="genform__field">
        <label htmlFor={docId}>Documento (opcional)</label>
        <select id={docId} value={selectedDoc ? documentId : ''} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">Todos los documentos</option>
          {(docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      <div className="genform__field">
        <label htmlFor={topicId}>Tema (opcional)</label>
        <input
          id={topicId}
          type="text"
          maxLength={MAX_TOPIC}
          value={topic}
          placeholder="Por ejemplo: la membrana celular"
          list={concepts.length > 0 ? conceptsListId : undefined}
          aria-describedby={concepts.length > 0 ? topicHintId : undefined}
          onChange={(e) => setTopic(e.target.value)}
        />
        {concepts.length > 0 && (
          <>
            <datalist id={conceptsListId}>
              {concepts.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p id={topicHintId} className="muted">
              Elige un concepto extraído de tus apuntes o escribe otro tema.
            </p>
          </>
        )}
      </div>

      <Alert>{docsError}</Alert>
      {noNotes && <p className="notice">{text.noNotes}</p>}
      <p className="notice">Generar preguntas con la IA local puede tardar varios minutos en un equipo sin tarjeta gráfica. Puedes cancelar en cualquier momento y conservar las preguntas ya generadas.</p>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={noNotes}>
          Generar
        </button>
      </div>
    </form>
  )
}
