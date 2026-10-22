import { useEffect, useState, type FormEvent } from 'react'
import type { Subject } from '../../../shared/api'
import { Alert } from '../components/Alert'
import { UNEXPECTED_ERROR } from '../errors'

interface Props {
  selectedId: number | null
  onSelect(subject: Subject): void
}

/** Barra lateral: lista de asignaturas + formulario para crear. */
export default function Subjects({ selectedId, onSelect }: Props) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let alive = true
    window.api.subjects
      .list()
      .then((res) => {
        if (!alive) return
        if (res.ok) setSubjects(res.data)
        else {
          setSubjects([])
          setError(res.error)
        }
      })
      .catch(() => {
        if (!alive) return
        setSubjects([])
        setError(UNEXPECTED_ERROR)
      })
    return () => {
      alive = false
    }
  }, [])

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await window.api.subjects.create(trimmed)
      if (!res.ok) return setError(res.error)
      setSubjects((prev) => [...(prev ?? []), res.data])
      setName('')
      onSelect(res.data)
    } catch {
      setError(UNEXPECTED_ERROR)
    } finally {
      setCreating(false)
    }
  }

  return (
    <nav aria-label="Asignaturas" className="subjects">
      <h2 className="subjects__title">Asignaturas</h2>
      {subjects === null ? (
        <p className="muted" role="status">
          Cargando…
        </p>
      ) : subjects.length === 0 ? (
        <p className="muted">Aún no hay asignaturas. Crea la primera abajo.</p>
      ) : (
        <ul className="subjects__list" aria-label="Asignaturas">
          {subjects.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="subjects__item"
                aria-current={s.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(s)}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void create(e)} className="subjects__form">
        <label htmlFor="new-subject">Nombre de la asignatura</label>
        <input id="new-subject" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} disabled={creating} />
        <button type="submit" className="btn btn--primary" disabled={creating || name.trim() === ''}>
          {creating ? 'Creando…' : 'Crear asignatura'}
        </button>
      </form>
      <Alert>{error}</Alert>
    </nav>
  )
}
