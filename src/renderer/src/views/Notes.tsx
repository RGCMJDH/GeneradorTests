import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfirmOcrOutcome, DocumentInfo, ImportItem, ImportKind } from '../../../shared/api'
import { Alert, Busy, Status } from '../components/Alert'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { UNEXPECTED_ERROR } from '../errors'
import Concepts from './Concepts'
import MobileUpload, { type ReceivedPhoto } from './MobileUpload'
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
  text: 'Importando…',
  pdf: 'Leyendo los PDF…',
  image: 'Leyendo las fotos con OCR… puede tardar hasta un minuto por foto.'
}

const NO_TEXT_REASON = 'no contiene texto seleccionable (probablemente es un escaneo)'
const NO_TEXT_HELP =
  'El OCR de esta aplicación solo funciona con imágenes, así que no se puede pasar un PDF por OCR directamente. ' +
  'Exporta sus páginas como imágenes (PNG o JPG) e impórtalas con «Importar foto».'

type Failed = Extract<ImportItem, { ok: false }>
type ImportedDoc = Extract<ImportItem, { ok: true; kind: 'text' | 'pdf' }>

/** Resumen de los archivos importados con texto (los de fotos van a la revisión OCR). */
function importedSummary(done: ImportedDoc[]): string {
  const warnings = done.filter((d) => d.warning).map((d) => ` Aviso en «${d.document.title}»: ${d.warning}`)
  const head =
    done.length === 1
      ? `«${done[0].document.title}» importado: ${fragmentos(done[0].document.chunkCount)}.`
      : `${done.length} archivos importados: ${done.map((d) => `«${d.document.title}» (${fragmentos(d.document.chunkCount)})`).join(', ')}.`
  return head + warnings.join('')
}

/** Qué archivos no se importaron y por qué. Un PDF escaneado lleva además la explicación de qué hacer. */
function failureMessage(failed: Failed[]): string {
  const head = failed.length === 1 ? 'No se pudo importar' : `${failed.length} archivos no se importaron`
  const list = failed.map((f) => `${f.file}: ${f.code === 'NO_TEXT' ? NO_TEXT_REASON : f.error}`).join('; ')
  return `${head}: ${list}.` + (failed.some((f) => f.code === 'NO_TEXT') ? ` ${NO_TEXT_HELP}` : '')
}

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
  const [mobileActive, setMobileActive] = useState(false)
  // Fotos del móvil ya reconocidas que esperan su turno de revisión (solo se revisa una a la vez).
  const [queued, setQueued] = useState<ReceivedPhoto[]>([])
  const docsHeading = useRef<HTMLHeadingElement>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const sid = subject.id

  useEffect(() => {
    onBlockingChange?.(busy ? 'import' : ocr ? 'ocr' : conceptsBusy ? 'concepts' : mobileActive ? 'mobile' : null)
  }, [busy, ocr, conceptsBusy, mobileActive, onBlockingChange])
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

  // Una foto del móvil entra por el MISMO camino que una importada en el PC: revisión OCR obligatoria antes de trocear.
  const onMobilePhoto = useCallback(
    (photo: ReceivedPhoto): void => {
      setQueued((q) => [...q, photo])
      void refresh()
    },
    [refresh]
  )
  useEffect(() => {
    const next = queued[0]
    if (!next || busy !== null || ocr !== null) return
    setQueued((q) => q.slice(1))
    setOcr({ documentId: next.documentId, text: next.text, missing: false })
  }, [queued, busy, ocr])

  // Se pueden elegir varios archivos a la vez: cada uno trae su resultado y uno que falla no frena a los demás.
  async function importFiles(kind: ImportKind): Promise<void> {
    setBusy(kind)
    setError(null)
    setStatus('')
    try {
      const res = await window.api.notes.importMany(sid, kind)
      if (!res.ok) return setError(res.error)
      if (res.data.canceled) return
      const { items } = res.data
      const docsDone = items.filter((i): i is ImportedDoc => i.ok && i.kind !== 'image')
      const photos = items.flatMap((i) => (i.ok && i.kind === 'image' ? [{ documentId: i.documentId, text: i.ocrText }] : []))
      const failed = items.filter((i): i is Failed => !i.ok)
      // Las fotos pasan por la misma cola de revisión que las del móvil: se revisan de una en una.
      if (photos.length > 0) setQueued((q) => [...q, ...photos])
      const parts = [
        docsDone.length > 0 ? importedSummary(docsDone) : '',
        photos.length > 1 ? `${photos.length} fotos leídas: revisa el texto de cada una antes de trocearlo.` : ''
      ]
      setStatus(parts.filter(Boolean).join(' '))
      if (failed.length > 0) setError(failureMessage(failed))
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
      setQueued((q) => q.filter((p) => p.documentId !== doc.id))
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
            <button key={b.kind} type="button" className="btn btn--primary" disabled={busy !== null || ocr !== null} onClick={() => void importFiles(b.kind)}>
              {b.label}
            </button>
          ))}
        </div>
        <p className="muted">Puedes elegir varios archivos a la vez.</p>
        {busy ? <Busy>{BUSY_TEXT[busy]}</Busy> : <Status>{status}</Status>}
        <Alert>{error}</Alert>
      </section>

      <MobileUpload subjectId={sid} onPhoto={onMobilePhoto} onActiveChange={setMobileActive} />

      {ocr && queued.length > 0 && (
        <p role="note" className="notice">
          {queued.length === 1 ? '1 foto más esperando revisión' : `${queued.length} fotos más esperando revisión`}: se abrirá al terminar esta revisión.
        </p>
      )}

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

      <Concepts subjectId={sid} docs={docs} onBusyChange={setConceptsBusy} />

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
