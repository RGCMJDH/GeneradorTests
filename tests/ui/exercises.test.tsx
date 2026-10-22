// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/src/App'
import ExercisesTab from '../../src/renderer/src/views/ExercisesTab'
import HistoryTab from '../../src/renderer/src/views/HistoryTab'
import { doc, installApi } from './fakeApi'
import { deferred, grade, okR, outcome, practicoQ, progressHarness, vfQ } from './quizFixtures'

const subject = { id: 7, name: 'Física' }
const NO_EXERCISES = 'No hay ejercicios prácticos en tus apuntes para ese tema (hace falta que incluyan datos o ejemplos resueltos)'

function setup(quiz: Record<string, unknown> = {}) {
  const harness = progressHarness()
  const api = installApi({
    notes: { list: vi.fn(() => okR([doc()])) },
    quiz: {
      onProgress: harness.onProgress,
      cancel: vi.fn(() => okR({ cancelled: true })),
      generate: vi.fn(() => okR(outcome([practicoQ()]))),
      startAttempt: vi.fn(() => okR({ attemptId: 5 })),
      finishAttempt: vi.fn(() => okR(null)),
      submit: vi.fn(() => okR(grade({ quote: practicoQ().quote }))),
      ...quiz
    } as never
  })
  const onShowHistory = vi.fn()
  render(<ExercisesTab subject={subject} onShowHistory={onShowHistory} />)
  return { api, onShowHistory }
}

async function toFirstExercise() {
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Empezar los ejercicios' }))
  await screen.findByRole('heading', { name: 'Ejercicio 1 de 1' })
}

async function answer(text = 'V = 2 · 10 = 20 V') {
  await userEvent.type(screen.getByRole('textbox', { name: practicoQ().prompt }), text)
  await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
  return screen.findByRole('region', { name: 'Corrección' })
}

describe('Ejercicios: formulario', () => {
  it('no ofrece selector de tipo y habla de ejercicios', async () => {
    setup()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText('Tipo de pregunta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Número de preguntas/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Número de ejercicios \(1–20\)/)).toHaveValue(5)
    expect(await screen.findByLabelText(/Documento/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Tema/)).toBeInTheDocument()
    expect(screen.getByText(/datos o ejemplos resueltos/)).toBeInTheDocument()
  })

  it('genera siempre con type "practico", con documento y tema', async () => {
    const { api } = setup()
    await userEvent.selectOptions(await screen.findByLabelText(/Documento/), 'Apuntes de célula')
    await userEvent.type(screen.getByLabelText(/Tema/), 'ohm')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await screen.findByRole('button', { name: 'Empezar los ejercicios' })
    expect(api.quiz.generate).toHaveBeenCalledTimes(1)
    expect(api.quiz.generate).toHaveBeenCalledWith(expect.objectContaining({ type: 'practico', count: 5, documentId: 1, topic: 'ohm', subjectId: 7 }))
  })

  it('el número no válido avisa con la palabra "ejercicios" y no genera', async () => {
    const { api } = setup()
    await userEvent.clear(screen.getByLabelText(/Número de ejercicios/))
    await userEvent.type(screen.getByLabelText(/Número de ejercicios/), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('El número de ejercicios debe ser un entero entre 1 y 20.')
    expect(api.quiz.generate).not.toHaveBeenCalled()
  })

  it('sin apuntes con texto no deja generar y lo explica con "ejercicios"', async () => {
    installApi({ notes: { list: vi.fn(() => okR([])) } })
    render(<ExercisesTab subject={subject} />)
    expect(await screen.findByText(/antes de generar ejercicios/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled()
  })
})

describe('Ejercicios: sin material', () => {
  it('insufficient sin ejercicios → mensaje específico y solo se puede volver al formulario', async () => {
    const generate = vi.fn(() => okR(outcome([], { insufficient: true, reasons: ['sin material suficiente para ejercicios prácticos'] })))
    setup({ generate })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText(NO_EXERCISES)).toBeInTheDocument()
    expect(screen.queryByText(/No hay material suficiente/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Empezar/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Volver al formulario' }))
    expect(screen.getByRole('button', { name: 'Generar' })).toBeInTheDocument()
  })

  it('el resumen cuenta ejercicios y descartes con esa palabra', async () => {
    setup({ generate: vi.fn(() => okR(outcome([practicoQ()], { discarded: 2, reasons: ['la cita no aparece literalmente en el fragmento'] }))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText('Se generó 1 ejercicio con cita de tus apuntes.')).toBeInTheDocument()
    expect(screen.getByText('Se descartaron 2 ejercicios que no se pudieron respaldar con tus apuntes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar otros' })).toBeInTheDocument()
  })

  it('un ejercicio sin cita no se muestra (misma regla que el test)', async () => {
    setup({ generate: vi.fn(() => okR(outcome([practicoQ({ quote: '  ' })]))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText(/1 ejercicio sin cita no se muestra/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Empezar/ })).not.toBeInTheDocument()
  })
})

describe('Ejercicios: resolver y corregir (reglas heredadas)', () => {
  it('el ejercicio se responde en un área de texto y la pantalla habla de ejercicios', async () => {
    setup()
    await toFirstExercise()
    const box = screen.getByRole('textbox', { name: practicoQ().prompt })
    expect(box.tagName).toBe('TEXTAREA')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saltar este ejercicio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terminar los ejercicios aquí' })).toBeInTheDocument()
  })

  it('cita verificada: la insignia solo vive en el bloque de la cita; el feedback es texto plano', async () => {
    const { api } = setup()
    await toFirstExercise()
    const region = await answer()
    expect(api.quiz.submit).toHaveBeenCalledWith({ subjectId: 7, attemptId: 5, questionId: 4, answer: 'V = 2 · 10 = 20 V' })
    const quote = within(region).getByLabelText('Fragmento de origen')
    expect(within(quote).getByText('Cita verificada en tus apuntes')).toBeInTheDocument()
    expect(within(region).getByTestId('feedback').textContent).not.toMatch(/verificad/i)
  })

  it('verified:false → sin insignia de verificación; solo el aviso de que no se pudo verificar', async () => {
    setup({ submit: vi.fn(() => okR(grade({ verified: false, quote: practicoQ().quote }))) })
    await toFirstExercise()
    const region = await answer()
    expect(screen.queryByText(/verificada en tus apuntes/)).not.toBeInTheDocument()
    expect(within(region).getByText('No se pudo verificar la cita')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'Ver en apuntes' })).toBeInTheDocument()
  })

  it('sin cita (quote vacío) no hay bloque de cita ni insignia', async () => {
    setup({ submit: vi.fn(() => okR(grade({ verified: false, quote: '' }))) })
    await toFirstExercise()
    const region = await answer()
    expect(within(region).queryByLabelText('Fragmento de origen')).not.toBeInTheDocument()
    expect(screen.queryByText(/verificad/i)).not.toBeInTheDocument()
  })

  it('al terminar muestra "Ejercicios terminados" y lleva al historial', async () => {
    const { api, onShowHistory } = setup()
    await toFirstExercise()
    await answer()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    expect(api.quiz.finishAttempt).toHaveBeenCalledWith(7, 5)
    expect(await screen.findByRole('heading', { name: 'Ejercicios terminados' })).toBeInTheDocument()
    expect(screen.getByText('1 de 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }))
    expect(onShowHistory).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Repetir con otros ejercicios' }))
    expect(screen.getByRole('button', { name: 'Generar' })).toBeInTheDocument()
  })

  it('salida de emergencia: terminar aquí en dos pasos cuenta lo respondido', async () => {
    const { api } = setup()
    await toFirstExercise()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar los ejercicios aquí' }))
    expect(api.quiz.finishAttempt).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '¿Seguro? Confirmar' }))
    expect(api.quiz.finishAttempt).toHaveBeenCalledWith(7, 5)
    expect(await screen.findByText('0 de 0 respondidas')).toBeInTheDocument()
  })

  it('mientras genera, el progreso habla de ejercicios', async () => {
    const gen = deferred<never>()
    setup({ generate: vi.fn(() => gen.promise) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByRole('heading', { name: 'Generando ejercicios' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '0 de 5 ejercicios')
  })
})

describe('Ejercicios: Historial', () => {
  it('un intento de ejercicios se etiqueta como "Ejercicio práctico"', async () => {
    installApi({
      history: {
        list: vi.fn(() =>
          okR([
            {
              id: 1,
              startedAt: '2026-10-22T14:05:00.000Z',
              finishedAt: '2026-10-22T14:10:00.000Z',
              answers: [
                { questionId: 4, prompt: practicoQ().prompt, type: 'practico' as const, userAnswer: '20 V', correct: true, feedback: 'Bien.', feedbackQuote: practicoQ().quote }
              ]
            }
          ])
        )
      }
    })
    render(<HistoryTab subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /1\/1/ }))
    expect(screen.getByText(/Ejercicio práctico/)).toBeVisible()
    expect(screen.queryByText(/verificad/i)).not.toBeInTheDocument()
  })
})

describe('Ejercicios dentro de la app', () => {
  const twoSubjects = vi.fn(() => okR([{ id: 7, name: 'Física' }, { id: 8, name: 'Química' }]))

  function appSetup(quiz: Record<string, unknown> = {}) {
    return installApi({
      subjects: { list: twoSubjects },
      notes: { list: vi.fn(() => okR([doc()])) },
      quiz: {
        onProgress: vi.fn(() => () => {}),
        generate: vi.fn(() => okR(outcome([practicoQ()]))),
        cancel: vi.fn(() => okR({ cancelled: true })),
        startAttempt: vi.fn(() => okR({ attemptId: 5 })),
        finishAttempt: vi.fn(() => okR(null)),
        submit: vi.fn(() => okR(grade())),
        ...quiz
      } as never
    })
  }
  async function openExercises() {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Física' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Ejercicios' }))
  }

  it('la pestaña Ejercicios muestra su formulario y la de Test conserva el selector de tipo', async () => {
    appSetup()
    await openExercises()
    const panel = screen.getByRole('tabpanel', { name: 'Ejercicios' })
    expect(within(panel).getByLabelText(/Número de ejercicios/)).toBeInTheDocument()
    expect(within(panel).queryByRole('radio')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Test' }))
    expect(within(screen.getByRole('tabpanel', { name: 'Test' })).getByRole('radio', { name: 'Tipo test' })).toBeInTheDocument()
  })

  it('los dos formularios montados a la vez no comparten ids (cada etiqueta apunta a su control)', async () => {
    appSetup()
    await openExercises()
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const testPanel = document.getElementById('panel-test') as HTMLElement
    const own = screen.getByLabelText(/Número de ejercicios/)
    const other = within(testPanel).getByLabelText(/Número de preguntas/)
    expect(other).not.toBe(own)
    expect(own.closest('[role="tabpanel"]')?.id).toBe('panel-exercises')
  })

  it('cambiar de asignatura con un ejercicio en curso pide confirmación', async () => {
    appSetup()
    await openExercises()
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar los ejercicios' }))
    await screen.findByRole('heading', { name: 'Ejercicio 1 de 1' })
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/en curso/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Física', level: 2 })).toBeInTheDocument()
  })

  it('un test de otro tipo no aparece en Ejercicios: cada pestaña tiene su propio estado', async () => {
    appSetup({ generate: vi.fn(() => okR(outcome([vfQ()]))) })
    await openExercises()
    await userEvent.click(screen.getByRole('tab', { name: 'Test' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await screen.findByRole('button', { name: 'Empezar el test' })
    await userEvent.click(screen.getByRole('tab', { name: 'Ejercicios' }))
    expect(screen.getByRole('button', { name: 'Generar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Empezar el test' })).not.toBeInTheDocument()
  })
})
