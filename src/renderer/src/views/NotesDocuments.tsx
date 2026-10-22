import type { DocumentInfo, ImportKind } from '../../../shared/api'

const TYPE_LABEL: Record<ImportKind, string> = { text: 'Texto', pdf: 'PDF', image: 'Foto' }

interface Props {
  docs: DocumentInfo[]
  viewing: number | null
  disabled: boolean
  /** Documento cuya revisión OCR está abierta: no se puede eliminar ni reanudar otra mientras tanto. */
  reviewingId: number | null
  onView(documentId: number | null): void
  onDelete(doc: DocumentInfo): void
  onResume(doc: DocumentInfo): void
}

/** Lista de documentos de la asignatura: título, tipo, nº de fragmentos, ver y eliminar. */
export function NotesDocuments({ docs, viewing, disabled, reviewingId, onView, onDelete, onResume }: Props) {
  if (docs.length === 0) return <p className="muted">Todavía no has importado apuntes en esta asignatura.</p>
  return (
    <ul className="docs" aria-label="Documentos">
      {docs.map((d) => (
        <li key={d.id} className={d.id === viewing ? 'docs__item docs__item--active' : 'docs__item'}>
          <div className="docs__main">
            <span className="docs__title">{d.title}</span>
            <span className="docs__meta">
              <span className="tag">{TYPE_LABEL[d.sourceType]}</span>{' '}
              {d.chunkCount === 0 ? 'Sin trocear' : `${d.chunkCount} ${d.chunkCount === 1 ? 'fragmento' : 'fragmentos'}`}
            </span>
          </div>
          <div className="row">
            {d.sourceType === 'image' && d.chunkCount === 0 && (
              <button type="button" className="btn btn--small btn--primary" aria-label={`Reanudar revisión de ${d.title}`} disabled={disabled || reviewingId !== null} onClick={() => onResume(d)}>
                Reanudar revisión
              </button>
            )}
            <button type="button" className="btn btn--small" aria-label={`Ver fragmentos de ${d.title}`} aria-pressed={d.id === viewing} onClick={() => onView(d.id === viewing ? null : d.id)}>
              Ver fragmentos
            </button>
            <button type="button" className="btn btn--small btn--danger-quiet" aria-label={`Eliminar ${d.title}`} disabled={disabled || d.id === reviewingId} onClick={() => onDelete(d)}>
              Eliminar
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
