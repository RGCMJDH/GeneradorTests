import { useEffect, useRef, useState } from 'react'
import type { Concept } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { useChunkFocus } from '../chunkFocus'
import { UNEXPECTED_ERROR } from '../errors'
import { newRequestId } from '../requestId'

interface Props {
  subjectId: number
  /** Avisa al padre de que hay una extracción en curso (se perdería al cambiar de asignatura). */
  onBusyChange?(busy: boolean): void
}

interface Job {
  requestId: string
  done: number
  total: number
  cancelling: boolean
}

const fragmentos = (n: number): string => `${n} ${n === 1 ? 'fragmento' : 'fragmentos'}`

/**
 * Índice de conceptos de la asignatura. Cada término procede literalmente de los apuntes (lo verifica el núcleo);
 * aquí todo se pinta como nodo de texto de React. «Ver fragmento» reutiliza el foco de fragmentos (como QuoteLink).
 */
export default function Concepts({ subjectId, onBusyChange }: Props) {
  const [concepts, setConcepts] = useState<Concept[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const alive = useRef(true)
  const running = useRef<{ requestId: string; off(): void } | null>(null)
  const { focusChunk } = useChunkFocus()
  const busy = job !== null

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // Al desmontar (p. ej. cambio de asignatura) se cancela lo que siga extrayéndose.
      const r = running.current
      if (r) {
        r.off()
        void Promise.resolve(window.api.concepts.cancel(r.requestId)).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])
  useEffect(() => () => onBusyChange?.(false), [onBusyChange])

  useEffect(() => {
    let live = true
    window.api.concepts
      .list(subjectId)
      .then((res) => {
        if (!live) return
        if (res.ok) setConcepts(res.data)
        else {
          setConcepts([])
          setError(res.error)
        }
      })
      .catch(() => {
        if (!live) return
        setConcepts([])
        setError(UNEXPECTED_ERROR)
      })
    return () => {
      live = false
    }
  }, [subjectId])

  async function extract(): Promise<void> {
    const requestId = newRequestId()
    setError(null)
    setStatus('')
    setJob({ requestId, done: 0, total: 0, cancelling: false })
    const off = window.api.concepts.onProgress((e) => {
      if (e.requestId !== requestId || !alive.current) return
      setJob((cur) => (cur && cur.requestId === requestId ? { ...cur, done: e.done, total: e.total } : cur))
    })
    running.current = { requestId, off }
    try {
      const res = await window.api.concepts.build({ requestId, subjectId })
      if (!alive.current) return
      if (!res.ok) setError(res.error)
      else if (res.data.cancelled) setStatus('Extracción cancelada: no se guardó nada y se conserva el índice anterior.')
      else {
        const out = res.data
        setConcepts(out.concepts)
        setSelected(null)
        const n = out.concepts.length
        setStatus(
          `${n} ${n === 1 ? 'concepto extraído' : 'conceptos extraídos'} de ${fragmentos(out.analyzed)}.` +
            (out.analyzed < out.total ? ` Se analizaron ${out.analyzed} de ${out.total} fragmentos (máximo por ejecución); el resto no se ha analizado.` : '')
        )
      }
    } catch {
      if (alive.current) setError(UNEXPECTED_ERROR)
    } finally {
      off()
      if (running.current?.requestId === requestId) running.current = null
      if (alive.current) setJob(null)
    }
  }

  async function cancel(): Promise<void> {
    const cur = job
    if (!cur || cur.cancelling) return
    setJob({ ...cur, cancelling: true })
    try {
      const res = await window.api.concepts.cancel(cur.requestId)
      if (!alive.current || res.ok) return
      setError(res.error)
    } catch {
      if (!alive.current) return
      setError(UNEXPECTED_ERROR)
    }
    // La cancelación falló: la extracción sigue y se puede volver a intentar.
    setJob((j) => (j && j.requestId === cur.requestId ? { ...j, cancelling: false } : j))
  }

  const current = concepts?.find((c) => c.term === selected) ?? null

  return (
    <section aria-labelledby="notes-concepts" className="concepts">
      <h3 id="notes-concepts">Conceptos</h3>
      <p className="muted">
        Términos clave que aparecen literalmente en tus apuntes. Extraerlos usa la IA local fragmento a fragmento y puede tardar varios minutos en un equipo sin tarjeta gráfica;
        se analizan como máximo los primeros 60 fragmentos. Puedes cancelar en cualquier momento.
      </p>
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void extract()}>
          Extraer conceptos
        </button>
        {job && (
          <button type="button" className="btn" disabled={job.cancelling} onClick={() => void cancel()}>
            Cancelar
          </button>
        )}
      </div>
      {job ? (
        <Busy>{job.cancelling ? 'Cancelando…' : job.total > 0 ? `Extrayendo conceptos… fragmento ${job.done} de ${job.total}` : 'Extrayendo conceptos…'}</Busy>
      ) : (
        // aria-live sin role="status": Apuntes ya tiene su propio estado de importación y no deben confundirse.
        <p className="status" aria-live="polite">
          {status}
        </p>
      )}
      <Alert>{error}</Alert>

      {concepts === null ? null : concepts.length === 0 ? (
        !busy && <p className="muted">Todavía no has extraído conceptos de esta asignatura.</p>
      ) : (
        <ul className="concepts__list" aria-label="Conceptos">
          {concepts.map((c) => (
            <li key={c.term}>
              <button type="button" className="chip" aria-pressed={c.term === selected} onClick={() => setSelected(c.term === selected ? null : c.term)}>
                {c.term} <span className="tag">{fragmentos(c.chunkIds.length)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && (
        <div role="region" aria-label={`Detalle de ${current.term}`} className="concepts__detail">
          <p>{current.related.length > 0 ? `Relacionados: ${current.related.join(', ')}` : 'Sin términos relacionados.'}</p>
          <div className="row">
            <span className="muted">Aparece en:</span>
            {current.chunkIds.map((id, i) => (
              <button key={id} type="button" className="link" onClick={() => focusChunk(id)}>
                {`Ver fragmento ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
