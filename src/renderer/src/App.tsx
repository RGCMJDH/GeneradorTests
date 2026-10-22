import { useCallback, useState } from 'react'
import type { Subject } from '../../shared/api'
import { ChunkFocusProvider } from './chunkFocus'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Tabs } from './components/Tabs'
import Diagnostics from './views/Diagnostics'
import ExercisesTab from './views/ExercisesTab'
import HistoryTab from './views/HistoryTab'
import Notes from './views/Notes'
import Subjects from './views/Subjects'
import TestTab from './views/TestTab'
import type { Blocking } from './views/types'

export default function App() {
  const [subject, setSubject] = useState<Subject | null>(null)
  const [tab, setTab] = useState('notes')
  // Trabajo sin terminar: importación en curso / revisión OCR (Apuntes) o test / ejercicios en curso. Cambiar de asignatura lo perdería.
  const [notesBlocking, setNotesBlocking] = useState<Blocking>(null)
  const [quizBlocking, setQuizBlocking] = useState<Blocking>(null)
  const [exercisesBlocking, setExercisesBlocking] = useState<Blocking>(null)
  const blocking = quizBlocking ?? exercisesBlocking ?? notesBlocking
  // Se guarda también el motivo del bloqueo en el momento de pedir el cambio: el texto del diálogo no cambia si el trabajo termina mientras está abierto.
  const [switchTo, setSwitchTo] = useState<{ to: Subject; kind: Blocking; exercises: boolean } | null>(null)
  // "Ver fragmento" desde cualquier pestaña trae primero la pestaña Apuntes.
  const revealNotes = useCallback(() => setTab('notes'), [])
  const showHistory = useCallback(() => setTab('history'), [])

  const trySelect = useCallback(
    (next: Subject) => {
      if (next.id === subject?.id) return
      if (blocking) setSwitchTo({ to: next, kind: blocking, exercises: quizBlocking === null && exercisesBlocking !== null })
      else setSubject(next)
    },
    [subject, blocking, quizBlocking, exercisesBlocking]
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
                  { id: 'notes', label: 'Apuntes', content: <Notes subject={subject} onBlockingChange={setNotesBlocking} /> },
                  { id: 'test', label: 'Test', content: <TestTab subject={subject} active={tab === 'test'} onBlockingChange={setQuizBlocking} onShowHistory={showHistory} /> },
                  { id: 'exercises', label: 'Ejercicios', content: <ExercisesTab subject={subject} active={tab === 'exercises'} onBlockingChange={setExercisesBlocking} onShowHistory={showHistory} /> },
                  { id: 'history', label: 'Historial', content: <HistoryTab subject={subject} active={tab === 'history'} /> }
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
            setSubject(switchTo.to)
            setSwitchTo(null)
          }}
        >
          {switchTo.kind === 'generating' ? (
            <p>
              {switchTo.exercises
                ? 'Hay una generación de ejercicios en curso. Si cambias de asignatura se cancelará y no podrás hacer los ejercicios con lo generado hasta ahora.'
                : 'Hay una generación de preguntas en curso. Si cambias de asignatura se cancelará y no podrás hacer el test con lo generado hasta ahora.'}
            </p>
          ) : switchTo.kind === 'quiz' && switchTo.exercises ? (
            <p>
              Tienes unos ejercicios en curso. Si cambias de asignatura quedarán sin terminar: los ejercicios sin responder quedarán fuera del intento. Las respuestas
              que ya enviaste se conservan en el historial como un intento sin terminar.
            </p>
          ) : switchTo.kind === 'quiz' ? (
            <p>
              Tienes un test en curso. Si cambias de asignatura quedará sin terminar: las preguntas sin responder quedarán fuera del intento. Las respuestas que ya
              enviaste se conservan en el historial como un intento sin terminar.
            </p>
          ) : switchTo.kind === 'ocr' ? (
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
