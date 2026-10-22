import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfirmOcrOutcome, DocumentInfo, ImportKind } from '../../../shared/api'
import { Alert, Busy, Status } from '../components/Alert'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { UNEXPECTED_ERROR } from '../errors'
import Concepts from './Concepts'
import { NotesChunks } from './NotesChunks'
import { NotesDocuments } from './NotesDocuments'
import OcrReview from './OcrReview'
import type { Blocking, TabProps } from './types'

const BUTTONS: { kind: ImportKind; label: string }[] = [
  { kind: 'text', label: 'Importar texto o Markdown' },
  { kind: 'pdf', label: 'Importar PDF' },
  { kind: 'image', label: 'Importar foto' }
]

const BUSY_TEXT: Record<ImportKind, string> = {
  text: 'Importando el archivo…',
  pdf: 'Leyendo el PDF…',
  image: 'Leyendo la imagen con OCR… puede tardar hasta un minuto.'
}

const NO_TEXT_MESSAGE =
  'Este PDF no contiene texto seleccionable (probablemente es un escaneo). El OCR de esta aplicación solo funciona con imágenes, ' +
  'así que no se puede pasar un PDF por OCR directamente. Exporta sus páginas como imágenes (PNG o JPG) e impórtalas con «Importar foto».'

export type { Blocking }

interface Props extends TabProps {
  /** Avisa al padre de que hay trabajo que se perdería al cambiar de asignatura (importación en curso o revisión OCR abierta). */
  onBlockingChange?(blocking: Blocking): void
}

const fragmentos = (n: number): string => `${n} ${n === 1 ? 'fragmento' : 'fragmentos'}`

/** Pestaña Apuntes: importar, documentos y visor de fragmentos. */
export default function Notes({ subject, onBlockingChange }: Props) {
  const [docs, setDocs] = useState<DocumentInfo[]>([])
  const [busy, setBusy] = useState<ImportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [ocr, setOcr] = useState<{ documentId: number; text: string; missing: boolean } | null>(null)
  const [toDelete, setToDelete] = useState<DocumentInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [conceptsBusy, setConceptsBusy] = useState(false)
  const docsHeading = useRef<HTMLHeadingElement>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const sid = subject.id

  useEffect(() => {
    onBlockingChange?.(busy ? 'import' : ocr ? 'ocr' : conceptsBusy ? 'concepts' : null)
  }, [busy, ocr, conceptsBusy, onBlockingChange])
  useEffect(() => () => onBlockingChange?.(null), [onBlockingChange])

  // Tras borrar/confirmar/descartar, el botón que abrió la acción ya no existe: el foco va a un destino estable.
  useEffect(() => {
    if (focusNonce > 0) docsHeading.current?.focus()
  }, [focusNonce])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await window.api.notes.list(sid)
      if (res.ok) setDocs(res.data)
      else setError(res.error)
    } catch {
      setError(UNEXPECTED_ERROR)
    }
    setReloadKey((k) => k + 1)
  }, [sid])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function importFile(kind: ImportKind): Promise<void> {
    setBusy(kind)
    setError(null)
    setStatus('')
    try {
      const res = await window.api.notes.import(sid, kind)
      if (!res.ok) return setError(res.code === 'NO_TEXT' ? NO_TEXT_MESSAGE : res.error)
      const out = res.data
      if (out.canceled) return
      if (out.kind === 'image') {
        setOcr({ documentId: out.documentId, text: out.ocrText, missing: false })
      } else {
        setStatus(`«${out.document.title}» importado: ${fragmentos(out.document.chunkCount)}.${out.warning ? ` Aviso: ${out.warning}` : ''}`)
      }
      await refresh()
    } catch {
      setError(UNEXPECTED_ERROR)
    } finally {
      setBusy(null)
    }
  }

  async function onOcrConfirmed(out: ConfirmOcrOutcome): Promise<void> {
    setOcr(null)
    setStatus(`Texto confirmado: ${fragmentos(out.chunkCount)}.` + (out.deletedQuestions > 0 ? ` Se borraron ${out.deletedQuestions} preguntas.` : ''))
    setViewing(out.documentId)
    await refresh()
    setFocusNonce((n) => n + 1)
  }

  async function onOcrDiscarded(): Promise<void> {
    setOcr(null)
    setStatus('Foto descartada.')
    await refresh()
    setFocusNonce((n) => n + 1)
  }

  async function deleteDoc(doc: DocumentInfo): Promise<void> {
    setDeleting(true)
    try {
      const res = await window.api.notes.deleteDocument(sid, doc.id)
      setToDelete(null)
      if (!res.ok) return setError(res.error)
      setError(null)
      setStatus(`«${doc.title}» eliminado.`)
      if (viewing === doc.id) setViewing(null)
      await refresh()
      setFocusNonce((n) => n + 1)
    } catch {
      setToDelete(null)
      setError(UNEXPECTED_ERROR)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="notes">
      <section aria-labelledby="notes-import">
        <h3 id="notes-import">Importar apuntes</h3>
        <div className="row">
          {BUTTONS.map((b) => (
            <button key={b.kind} type="button" className="btn btn--primary" disabled={busy !== null || ocr !== null} onClick={() => void importFile(b.kind)}>
              {b.label}
            </button>
          ))}
        </div>
        {busy ? <Busy>{BUSY_TEXT[busy]}</Busy> : <Status>{status}</Status>}
        <Alert>{error}</Alert>
      </section>

      {ocr && (
        <OcrReview
          key={ocr.documentId}
          subjectId={sid}
          documentId={ocr.documentId}
          initialText={ocr.text}
          textMissing={ocr.missing}
          onConfirmed={(o) => void onOcrConfirmed(o)}
          onDiscarded={() => void onOcrDiscarded()}
        />
      )}

      <section aria-labelledby="notes-docs">
        <h3 id="notes-docs" ref={docsHeading} tabIndex={-1}>
          Documentos
        </h3>
        <NotesDocuments
          docs={docs}
          viewing={viewing}
          disabled={busy !== null}
          reviewingId={ocr?.documentId ?? null}
          onView={setViewing}
          onDelete={setToDelete}
          onResume={(d) => setOcr({ documentId: d.id, text: '', missing: true })}
        />
      </section>

      <Concepts subjectId={sid} onBusyChange={setConceptsBusy} />

      <section aria-labelledby="notes-chunks">
        <h3 id="notes-chunks">Fragmentos</h3>
        <NotesChunks subjectId={sid} docs={docs} documentId={viewing} reloadKey={reloadKey} onViewDocument={setViewing} />
      </section>

      {toDelete && (
        <ConfirmDialog title="Eliminar documento" confirmLabel="Eliminar" danger busy={deleting} onCancel={() => setToDelete(null)} onConfirm={() => void deleteDoc(toDelete)}>
          <p>
            Se eliminará «{toDelete.title}» con sus {toDelete.chunkCount} fragmentos y las preguntas generadas a partir de ellos. No se puede deshacer.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
