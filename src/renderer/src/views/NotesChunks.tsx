import { useEffect, useRef, useState } from 'react'
import type { Chunk, DocumentInfo } from '../../../shared/api'
import { Alert } from '../components/Alert'
import { chunkAnchorId, scrollToChunk, useChunkFocus } from '../chunkFocus'

interface Props {
  subjectId: number
  docs: DocumentInfo[]
  /** null = fragmentos de todos los documentos. */
  documentId: number | null
  /** Cambia cuando se importa/borra/trocea algo para recargar. */
  reloadKey: number
  onViewDocument(documentId: number | null): void
}

/**
 * Visor de fragmentos. El texto se pinta SIEMPRE como nodo de texto de React (nunca HTML).
 * Atiende las peticiones de `useChunkFocus` (QuoteLink): carga el documento del fragmento si hace falta, hace scroll y lo resalta.
 */
export function NotesChunks({ subjectId, docs, documentId, reloadKey, onViewDocument }: Props) {
  const [chunks, setChunks] = useState<Chunk[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const { request } = useChunkFocus()
  const chunksRef = useRef<Chunk[] | null>(null)
  chunksRef.current = chunks
  // Una petición anterior al montaje (otra asignatura) no se vuelve a ejecutar.
  const handled = useRef(request?.nonce)

  useEffect(() => {
    let alive = true
    setChunks(null)
    const load = documentId === null ? window.api.notes.chunks(subjectId) : window.api.notes.chunks(subjectId, documentId)
    void load.then((res) => {
      if (!alive) return
      if (res.ok) {
        setChunks(res.data)
        setError(null)
      } else {
        setChunks([])
        setError(res.error)
      }
    })
    return () => {
      alive = false
    }
  }, [subjectId, documentId, reloadKey])

  // Petición externa de "ver fragmento": si no está cargado, averigua su documento y cambia a él.
  useEffect(() => {
    if (!request || request.nonce === handled.current) return
    handled.current = request.nonce
    setPending(request.chunkId)
    if (chunksRef.current?.some((c) => c.id === request.chunkId)) return
    void window.api.notes.chunk(subjectId, request.chunkId).then((res) => {
      if (res.ok) onViewDocument(res.data.documentId)
      else {
        setPending(null)
        setError(res.error)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona a una petición nueva
  }, [request])

  useEffect(() => {
    if (pending === null || !chunks?.some((c) => c.id === pending)) return
    scrollToChunk(pending)
    setHighlight(pending)
    setPending(null)
  }, [pending, chunks])

  const title = (id: number): string => docs.find((d) => d.id === id)?.title ?? 'Documento'

  return (
    <div className="chunks">
      <Alert>{error}</Alert>
      {chunks === null ? (
        <p className="muted" role="status">
          Cargando fragmentos…
        </p>
      ) : chunks.length === 0 ? (
        !error && <p className="muted">No hay fragmentos que mostrar.</p>
      ) : (
        <>
          {documentId !== null && (
            <p className="muted">
              Mostrando los fragmentos de «{title(documentId)}».{' '}
              <button type="button" className="link" onClick={() => onViewDocument(null)}>
                Ver todos
              </button>
            </p>
          )}
          <div className="chunks__list">
            {chunks.map((c) => (
              <article key={c.id} id={chunkAnchorId(c.id)} tabIndex={-1} className={c.id === highlight ? 'chunk chunk--focused' : 'chunk'} aria-label={`Fragmento ${c.position + 1} de ${title(c.documentId)}`}>
                <header className="chunk__head">
                  {title(c.documentId)} · fragmento {c.position + 1}
                </header>
                <p className="chunk__text">{c.text}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
