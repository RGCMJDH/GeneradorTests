import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DocumentInfo, QuestionType } from '../../../shared/api'
import { UNEXPECTED_ERROR } from '../errors'
import { Alert } from './Alert'

export const MIN_COUNT = 1
export const MAX_COUNT = 20
export const MAX_TOPIC = 200

export type FormType = Extract<QuestionType, 'vf' | 'test' | 'desarrollo'>

const TYPES: { value: FormType; label: string }[] = [
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
  /** La pestaña está visible: se recarga la lista de documentos por si se importó algo en Apuntes. */
  active: boolean
  /** Mueve el foco al primer control al montarse (al volver de otra fase). */
  focusFirst?: boolean
  onGenerate(params: GenerateParams): void
}

/** Formulario de generación: tipo, nº de preguntas (1–20), documento y tema opcionales. */
export function GenerateForm({ subjectId, active, focusFirst = false, onGenerate }: Props) {
  const firstRadio = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<FormType>('vf')
  const [countText, setCountText] = useState('5')
  const [documentId, setDocumentId] = useState('')
  const [topic, setTopic] = useState('')
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [countError, setCountError] = useState<string | null>(null)

  useEffect(() => {
    if (focusFirst) firstRadio.current?.focus()
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

  // Un documento elegido que ya no existe vuelve a "todos".
  const selectedDoc = docs?.find((d) => String(d.id) === documentId)
  const noNotes = docs !== null && docs.length === 0

  function submit(e: FormEvent): void {
    e.preventDefault()
    const trimmed = countText.trim()
    const count = Number(trimmed)
    if (trimmed === '' || !Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
      return setCountError(`El número de preguntas debe ser un entero entre ${MIN_COUNT} y ${MAX_COUNT}.`)
    }
    setCountError(null)
    const t = topic.trim()
    onGenerate({ type, count, ...(selectedDoc ? { documentId: selectedDoc.id } : {}), ...(t ? { topic: t } : {}) })
  }

  return (
    <form className="card genform" onSubmit={submit} noValidate>
      <fieldset className="genform__types">
        <legend>Tipo de pregunta</legend>
        {TYPES.map((t) => (
          <label key={t.value} className="option">
            <input ref={t.value === type ? firstRadio : undefined} type="radio" name="gen-type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="genform__field">
        <label htmlFor="gen-count">Número de preguntas ({MIN_COUNT}–{MAX_COUNT})</label>
        <input
          id="gen-count"
          type="number"
          inputMode="numeric"
          min={MIN_COUNT}
          max={MAX_COUNT}
          value={countText}
          aria-invalid={countError ? true : undefined}
          aria-describedby={countError ? 'gen-count-error' : undefined}
          onChange={(e) => setCountText(e.target.value)}
        />
        {countError && (
          <div id="gen-count-error">
            <Alert>{countError}</Alert>
          </div>
        )}
      </div>

      <div className="genform__field">
        <label htmlFor="gen-doc">Documento (opcional)</label>
        <select id="gen-doc" value={selectedDoc ? documentId : ''} onChange={(e) => setDocumentId(e.target.value)}>
          <option value="">Todos los documentos</option>
          {(docs ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      <div className="genform__field">
        <label htmlFor="gen-topic">Tema (opcional)</label>
        <input id="gen-topic" type="text" maxLength={MAX_TOPIC} value={topic} placeholder="Por ejemplo: la membrana celular" onChange={(e) => setTopic(e.target.value)} />
      </div>

      <Alert>{docsError}</Alert>
      {noNotes && <p className="notice">Esta asignatura aún no tiene apuntes con texto. Importa apuntes en la pestaña Apuntes antes de generar un test.</p>}
      <p className="notice">Generar preguntas con la IA local puede tardar varios minutos en un equipo sin tarjeta gráfica. Puedes cancelar en cualquier momento y conservar las preguntas ya generadas.</p>
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={noNotes}>
          Generar
        </button>
      </div>
    </form>
  )
}
