import type { DocumentInfo, ImportKind } from '../../../shared/api'

const TYPE_LABEL: Record<ImportKind, string> = { text: 'Texto', pdf: 'PDF', image: 'Foto' }

interface Props {
  docs: DocumentInfo[]
  viewing: number | null
  disabled: boolean
  onView(documentId: number | null): void
  onDelete(doc: DocumentInfo): void
}

/** Lista de documentos de la asignatura: título, tipo, nº de fragmentos, ver y eliminar. */
export function NotesDocuments({ docs, viewing, disabled, onView, onDelete }: Props) {
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
            <button type="button" className="btn btn--small" aria-label={`Ver fragmentos de ${d.title}`} aria-pressed={d.id === viewing} onClick={() => onView(d.id === viewing ? null : d.id)}>
              Ver fragmentos
            </button>
            <button type="button" className="btn btn--small btn--danger-quiet" aria-label={`Eliminar ${d.title}`} disabled={disabled} onClick={() => onDelete(d)}>
              Eliminar
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
