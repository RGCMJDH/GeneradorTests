import { useCallback, useEffect, useState } from 'react'
import type { HistoryAttempt } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { HistoryAttemptItem } from '../components/HistoryAttemptItem'
import { UNEXPECTED_ERROR } from '../errors'
import type { TabProps } from './types'

interface Props extends TabProps {
  /** La pestaña está visible: se recarga cada vez que se muestra para ver los intentos recién hechos. */
  active?: boolean
}

/** Pestaña Historial: intentos de la asignatura con nota y detalle desplegable. */
export default function HistoryTab({ subject, active = true }: Props) {
  const [attempts, setAttempts] = useState<HistoryAttempt[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const sid = subject.id

  const load = useCallback(async (isAlive: () => boolean): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.history.list(sid)
      if (!isAlive()) return
      if (res.ok) setAttempts([...res.data].sort((a, b) => b.id - a.id))
      else setError(res.error)
    } catch {
      if (isAlive()) setError(UNEXPECTED_ERROR)
    } finally {
      if (isAlive()) setLoading(false)
    }
  }, [sid])

  useEffect(() => {
    if (!active) return
    let alive = true
    void load(() => alive)
    return () => {
      alive = false
    }
  }, [active, load])

  return (
    <section aria-labelledby="history-title">
      <h3 id="history-title" style={{ marginTop: 0 }}>
        Historial de tests
      </h3>
      <Alert>{error}</Alert>
      {error && (
        <button type="button" className="btn" disabled={loading} onClick={() => void load(() => true)}>
          Reintentar
        </button>
      )}
      {loading && attempts === null && <Busy>Cargando el historial…</Busy>}
      {attempts !== null && attempts.length === 0 && <p className="muted">Todavía no has hecho ningún test en esta asignatura.</p>}
      {attempts !== null && attempts.length > 0 && (
        <ul className="attempts" aria-label="Intentos">
          {attempts.map((a) => (
            <HistoryAttemptItem key={a.id} attempt={a} />
          ))}
        </ul>
      )}
    </section>
  )
}
