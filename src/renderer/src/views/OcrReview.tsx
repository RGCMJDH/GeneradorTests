import { useId, useState } from 'react'
import type { ConfirmOcrOutcome } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { ConfirmDialog } from '../components/ConfirmDialog'

interface Props {
  subjectId: number
  documentId: number
  initialText: string
  onConfirmed(outcome: ConfirmOcrOutcome): void
  onDiscarded(): void
}

type Dialog = { kind: 'questions'; count: number } | { kind: 'discard' } | null

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Revisión del texto OCR de una foto antes de trocearlo. Es la única vía para que ese texto entre en la asignatura. */
export default function OcrReview({ subjectId, documentId, initialText, onConfirmed, onDiscarded }: Props) {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const areaId = useId()

  async function confirm(force: boolean): Promise<void> {
    setBusy('confirm')
    setError(null)
    // Sin force: si hay preguntas guardadas, main responde WOULD_DELETE_QUESTIONS y no toca nada.
    const res = force ? await window.api.notes.confirmOcr(documentId, text, true) : await window.api.notes.confirmOcr(documentId, text)
    setBusy(null)
    if (res.ok) {
      setDialog(null)
      return onConfirmed(res.data)
    }
    if (res.code === 'WOULD_DELETE_QUESTIONS') return setDialog({ kind: 'questions', count: res.count ?? 0 })
    setDialog(null)
    setError(res.error)
  }

  async function discard(): Promise<void> {
    setBusy('discard')
    setError(null)
    const res = await window.api.notes.deleteDocument(subjectId, documentId)
    setBusy(null)
    setDialog(null)
    if (res.ok) onDiscarded()
    else setError(res.error)
  }

  return (
    <section className="ocr card" aria-labelledby={`${areaId}-h`}>
      <h4 id={`${areaId}-h`}>Revisa el texto reconocido</h4>
      <p role="note" className="notice">
        <strong>Ojo:</strong> el OCR lee mal la letra manuscrita y puede equivocarse en cualquier texto. Revisa y corrige el texto antes de
        trocear: lo que confirmes es lo único que se usará para generar preguntas.
      </p>
      <label htmlFor={areaId}>Texto reconocido (OCR), editable</label>
      <textarea id={areaId} className="ocr__text" rows={12} value={text} onChange={(e) => setText(e.target.value)} disabled={busy !== null} spellCheck />
      {busy === 'confirm' && <Busy>Troceando el texto…</Busy>}
      <Alert>{error}</Alert>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={busy !== null || text.trim() === ''} onClick={() => void confirm(false)}>
          {busy === 'confirm' ? 'Troceando…' : 'Confirmar y trocear'}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={() => setDialog({ kind: 'discard' })}>
          Descartar foto
        </button>
      </div>

      {dialog?.kind === 'questions' && (
        <ConfirmDialog
          title="Se borrarán preguntas"
          confirmLabel="Sí, borrar y continuar"
          danger
          busy={busy !== null}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirm(true)}
        >
          <p>
            Al volver a trocear este documento se borrarán {plural(dialog.count, 'pregunta ya generada', 'preguntas ya generadas')} a partir de
            sus fragmentos actuales. Esta acción no se puede deshacer.
          </p>
        </ConfirmDialog>
      )}
      {dialog?.kind === 'discard' && (
        <ConfirmDialog
          title="Descartar la foto"
          confirmLabel="Descartar"
          danger
          busy={busy !== null}
          onCancel={() => setDialog(null)}
          onConfirm={() => void discard()}
        >
          <p>Se eliminará el documento de esta foto y se perderá el texto reconocido.</p>
        </ConfirmDialog>
      )}
    </section>
  )
}
