import { useEffect, useRef, useState } from 'react'
import type { Chunk, DocumentInfo } from '../../../shared/api'
import { Alert } from '../components/Alert'
import { UNEXPECTED_ERROR } from '../errors'
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

/** Lista cargada junto con el documento para el que se cargó (evita confundir listas de documentos distintos). */
interface Loaded {
  docId: number | null
  list: Chunk[]
}

/**
 * Visor de fragmentos. El texto se pinta SIEMPRE como nodo de texto de React (nunca HTML).
 * Atiende las peticiones de `useChunkFocus` (QuoteLink): carga el documento del fragmento si hace falta, hace scroll y lo resalta.
 * Si el fragmento no está disponible lo avisa y deja limpio el estado (nada pendiente ni resaltado).
 */
export function NotesChunks({ subjectId, docs, documentId, reloadKey, onViewDocument }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<number | null>(null)
  const [highlight, setHighlight] = useState<number | null>(null)
  const { request } = useChunkFocus()
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const docRef = useRef(documentId)
  docRef.current = documentId
  // 'fetch' = averiguando el documento del fragmento; número = esperando a que cargue ese documento; null = nada.
  const awaiting = useRef<number | 'fetch' | null>(null)
  // Una petición anterior al montaje (otra asignatura) no se vuelve a ejecutar.
  const handled = useRef(request?.nonce)

  useEffect(() => {
    let alive = true
    setLoaded(null)
    const load = documentId === null ? window.api.notes.chunks(subjectId) : window.api.notes.chunks(subjectId, documentId)
    load
      .then((res) => {
        if (!alive) return
        if (res.ok) {
          setLoaded({ docId: documentId, list: res.data })
          setError(null)
        } else {
          setLoaded({ docId: documentId, list: [] })
          setError(res.error)
        }
      })
      .catch(() => {
        if (!alive) return
        setLoaded({ docId: documentId, list: [] })
        setError(UNEXPECTED_ERROR)
      })
    return () => {
      alive = false
    }
  }, [subjectId, documentId, reloadKey])

  const unavailable = (message: string): void => {
    awaiting.current = null
    setPending(null)
    setHighlight(null)
    setError(message)
  }

  // Petición externa de "ver fragmento": si no está cargado, averigua su documento y cambia a él.
  useEffect(() => {
    if (!request || request.nonce === handled.current) return
    handled.current = request.nonce
    setHighlight(null)
    setPending(request.chunkId)
    if (loadedRef.current?.list.some((c) => c.id === request.chunkId)) {
      awaiting.current = null
      return
    }
    awaiting.current = 'fetch'
    window.api.notes
      .chunk(subjectId, request.chunkId)
      .then((res) => {
        if (!res.ok) return unavailable(res.error)
        if (res.data.documentId === docRef.current) return unavailable('Ese fragmento ya no está disponible.')
        awaiting.current = res.data.documentId
        onViewDocument(res.data.documentId)
      })
      .catch(() => unavailable(UNEXPECTED_ERROR))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona a una petición nueva
  }, [request])

  useEffect(() => {
    if (pending === null || !loaded || loaded.docId !== documentId) return
    if (loaded.list.some((c) => c.id === pending)) {
      awaiting.current = null
      scrollToChunk(pending)
      setHighlight(pending)
      setPending(null)
    } else if (awaiting.current === null || awaiting.current === documentId) {
      unavailable('Ese fragmento ya no está disponible.')
    }
  }, [pending, loaded, documentId])

  const chunks = loaded && loaded.docId === documentId ? loaded.list : null
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
