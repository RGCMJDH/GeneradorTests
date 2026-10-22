import { useCallback, useEffect, useState } from 'react'
import type { ConfirmOcrOutcome, DocumentInfo, ImportKind } from '../../../shared/api'
import { Alert, Busy, Status } from '../components/Alert'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { NotesChunks } from './NotesChunks'
import { NotesDocuments } from './NotesDocuments'
import OcrReview from './OcrReview'
import type { TabProps } from './types'

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

/** Pestaña Apuntes: importar, documentos y visor de fragmentos. */
export default function Notes({ subject }: TabProps) {
  const [docs, setDocs] = useState<DocumentInfo[]>([])
  const [busy, setBusy] = useState<ImportKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [ocr, setOcr] = useState<{ documentId: number; text: string } | null>(null)
  const [toDelete, setToDelete] = useState<DocumentInfo | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const sid = subject.id

  const refresh = useCallback(async (): Promise<void> => {
    const res = await window.api.notes.list(sid)
    if (res.ok) setDocs(res.data)
    else setError(res.error)
    setReloadKey((k) => k + 1)
  }, [sid])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function importFile(kind: ImportKind): Promise<void> {
    setBusy(kind)
    setError(null)
    setStatus('')
    const res = await window.api.notes.import(sid, kind)
    setBusy(null)
    if (!res.ok) return setError(res.code === 'NO_TEXT' ? NO_TEXT_MESSAGE : res.error)
    const out = res.data
    if (out.canceled) return
    if (out.kind === 'image') {
      setOcr({ documentId: out.documentId, text: out.ocrText })
    } else {
      const n = out.document.chunkCount
      setStatus(`«${out.document.title}» importado: ${n} ${n === 1 ? 'fragmento' : 'fragmentos'}.${out.warning ? ` Aviso: ${out.warning}` : ''}`)
    }
    await refresh()
  }

  async function onOcrConfirmed(out: ConfirmOcrOutcome): Promise<void> {
    setOcr(null)
    setStatus(`Texto confirmado: ${out.chunkCount} ${out.chunkCount === 1 ? 'fragmento' : 'fragmentos'}.` + (out.deletedQuestions > 0 ? ` Se borraron ${out.deletedQuestions} preguntas.` : ''))
    setViewing(out.documentId)
    await refresh()
  }

  async function onOcrDiscarded(): Promise<void> {
    setOcr(null)
    setStatus('Foto descartada.')
    await refresh()
  }

  async function deleteDoc(doc: DocumentInfo): Promise<void> {
    setDeleting(true)
    const res = await window.api.notes.deleteDocument(sid, doc.id)
    setDeleting(false)
    setToDelete(null)
    if (!res.ok) return setError(res.error)
    setError(null)
    setStatus(`«${doc.title}» eliminado.`)
    if (viewing === doc.id) setViewing(null)
    await refresh()
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

      {ocr && <OcrReview key={ocr.documentId} subjectId={sid} documentId={ocr.documentId} initialText={ocr.text} onConfirmed={(o) => void onOcrConfirmed(o)} onDiscarded={() => void onOcrDiscarded()} />}

      <section aria-labelledby="notes-docs">
        <h3 id="notes-docs">Documentos</h3>
        <NotesDocuments docs={docs} viewing={viewing} disabled={busy !== null} onView={setViewing} onDelete={setToDelete} />
      </section>

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
