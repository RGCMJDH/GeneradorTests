import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** Id del elemento DOM de un fragmento (ancla navegable `#chunk-<id>`). */
export const chunkAnchorId = (chunkId: number): string => `chunk-${chunkId}`

export interface FocusRequest {
  chunkId: number
  /** Cambia en cada petición para que pedir el mismo fragmento dos veces vuelva a resaltarlo. */
  nonce: number
}

interface ChunkFocus {
  request: FocusRequest | null
  /**
   * Muestra la pestaña Apuntes y hace scroll + resalta el fragmento. QuoteLink (Task 11) lo reutiliza.
   *
   * Limitación: la petición la atiende la vista Apuntes (NotesChunks) que esté MONTADA en ese momento.
   * Las pestañas siguen montadas mientras se cambia entre ellas, pero al cambiar de asignatura Apuntes se vuelve
   * a montar y descarta una petición anterior a su montaje (no se re-ejecuta una petición "vieja").
   * Si el fragmento ya no existe, NotesChunks lo indica con un aviso y no deja nada resaltado.
   */
  focusChunk(chunkId: number): void
}

const ChunkFocusContext = createContext<ChunkFocus>({ request: null, focusChunk: () => {} })

export function ChunkFocusProvider({ onReveal, children }: { onReveal(): void; children: ReactNode }) {
  const [request, setRequest] = useState<FocusRequest | null>(null)
  const focusChunk = useCallback(
    (chunkId: number) => {
      onReveal()
      setRequest((prev) => ({ chunkId, nonce: (prev?.nonce ?? 0) + 1 }))
    },
    [onReveal]
  )
  const value = useMemo(() => ({ request, focusChunk }), [request, focusChunk])
  return <ChunkFocusContext.Provider value={value}>{children}</ChunkFocusContext.Provider>
}

export const useChunkFocus = (): ChunkFocus => useContext(ChunkFocusContext)

/** Desplaza hasta el fragmento y le da el foco (para lectores de pantalla). Devuelve false si no está en el DOM. */
export function scrollToChunk(chunkId: number): boolean {
  const el = document.getElementById(chunkAnchorId(chunkId))
  if (!el) return false
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  el.focus({ preventScroll: true })
  return true
}
