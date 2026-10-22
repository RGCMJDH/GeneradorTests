import { useCallback, useState } from 'react'
import type { Subject } from '../../shared/api'
import { ChunkFocusProvider } from './chunkFocus'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Tabs } from './components/Tabs'
import Diagnostics from './views/Diagnostics'
import ExercisesTab from './views/ExercisesTab'
import HistoryTab from './views/HistoryTab'
import Notes, { type Blocking } from './views/Notes'
import Subjects from './views/Subjects'
import TestTab from './views/TestTab'

export default function App() {
  const [subject, setSubject] = useState<Subject | null>(null)
  const [tab, setTab] = useState('notes')
  // Trabajo sin terminar en Apuntes (importación en curso / revisión OCR): cambiar de asignatura lo perdería.
  const [blocking, setBlocking] = useState<Blocking>(null)
  const [switchTo, setSwitchTo] = useState<Subject | null>(null)
  // "Ver fragmento" desde cualquier pestaña trae primero la pestaña Apuntes.
  const revealNotes = useCallback(() => setTab('notes'), [])

  const trySelect = useCallback(
    (next: Subject) => {
      if (next.id === subject?.id) return
      if (blocking) setSwitchTo(next)
      else setSubject(next)
    },
    [subject, blocking]
  )

  return (
    <ChunkFocusProvider onReveal={revealNotes}>
      <div className="app">
        <aside className="sidebar">
          <h1 className="sidebar__brand">Generador de tests</h1>
          <Subjects selectedId={subject?.id ?? null} onSelect={trySelect} />
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
                  { id: 'notes', label: 'Apuntes', content: <Notes subject={subject} onBlockingChange={setBlocking} /> },
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
      {switchTo && (
        <ConfirmDialog
          title="Cambiar de asignatura"
          confirmLabel="Cambiar y perder el trabajo"
          danger
          onCancel={() => setSwitchTo(null)}
          onConfirm={() => {
            setSubject(switchTo)
            setSwitchTo(null)
          }}
        >
          {blocking === 'ocr' ? (
            <p>
              Tienes una revisión de OCR sin confirmar. Si cambias de asignatura se perderá el texto reconocido: la foto quedará como documento «Sin trocear» y
              podrás reanudar la revisión, pero tendrás que escribir el texto de nuevo.
            </p>
          ) : (
            <p>Hay una importación en curso. Si cambias de asignatura se perderá su resultado y no verás cuándo termina.</p>
          )}
        </ConfirmDialog>
      )}
    </ChunkFocusProvider>
  )
}
