import { useCallback, useState } from 'react'
import type { Subject } from '../../shared/api'
import { ChunkFocusProvider } from './chunkFocus'
import { Tabs } from './components/Tabs'
import Diagnostics from './views/Diagnostics'
import ExercisesTab from './views/ExercisesTab'
import HistoryTab from './views/HistoryTab'
import Notes from './views/Notes'
import Subjects from './views/Subjects'
import TestTab from './views/TestTab'

export default function App() {
  const [subject, setSubject] = useState<Subject | null>(null)
  const [tab, setTab] = useState('notes')
  // "Ver fragmento" desde cualquier pestaña trae primero la pestaña Apuntes.
  const revealNotes = useCallback(() => setTab('notes'), [])

  return (
    <ChunkFocusProvider onReveal={revealNotes}>
      <div className="app">
        <aside className="sidebar">
          <h1 className="sidebar__brand">Generador de tests</h1>
          <Subjects selectedId={subject?.id ?? null} onSelect={setSubject} />
        </aside>
        <main className="main">
          <div className="main__top">
            <Diagnostics />
          </div>
          {subject ? (
            // key: al cambiar de asignatura cada vista empieza limpia y nunca mezcla datos entre asignaturas.
            <section key={subject.id} aria-labelledby="subject-name">
              <h2 id="subject-name" className="main__title">
                {subject.name}
              </h2>
              <Tabs
                label={`Secciones de ${subject.name}`}
                active={tab}
                onChange={setTab}
                tabs={[
                  { id: 'notes', label: 'Apuntes', content: <Notes subject={subject} /> },
                  { id: 'test', label: 'Test', content: <TestTab subject={subject} /> },
                  { id: 'exercises', label: 'Ejercicios', content: <ExercisesTab subject={subject} /> },
                  { id: 'history', label: 'Historial', content: <HistoryTab subject={subject} /> }
                ]}
              />
            </section>
          ) : (
            <p className="empty">Elige o crea una asignatura para empezar.</p>
          )}
        </main>
      </div>
    </ChunkFocusProvider>
  )
}
