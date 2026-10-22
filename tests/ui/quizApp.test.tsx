// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/src/App'
import { doc, installApi } from './fakeApi'
import { deferred, grade, okR, outcome, progressHarness, vfQ } from './quizFixtures'

const twoSubjects = vi.fn(() => okR([{ id: 7, name: 'Biología' }, { id: 8, name: 'Química' }]))
const chunk = (id: number, text: string) => ({ id, documentId: 1, subjectId: 7, position: id, text })

function setup(over: Record<string, unknown> = {}, history?: unknown) {
  Element.prototype.scrollIntoView = vi.fn()
  const harness = progressHarness()
  const api = installApi({
    subjects: { list: twoSubjects },
    notes: {
      list: vi.fn(() => okR([doc()])),
      chunks: vi.fn(() => okR([chunk(10, 'otro fragmento'), chunk(11, 'La célula es la unidad básica de la vida')])),
      chunk: vi.fn(() => okR({ id: 11, documentId: 1, documentTitle: 'Apuntes de célula', position: 1, text: 'La célula es la unidad básica de la vida' }))
    },
    quiz: {
      onProgress: harness.onProgress,
      generate: vi.fn(() => okR(outcome([vfQ()]))),
      cancel: vi.fn(() => okR({ cancelled: true })),
      startAttempt: vi.fn(() => okR({ attemptId: 5 })),
      submit: vi.fn(() => okR(grade())),
      finishAttempt: vi.fn(() => okR(null)),
      ...over
    } as never,
    ...(history ? { history: { list: history as never } } : {})
  })
  return api
}

async function openTest() {
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
  await userEvent.click(screen.getByRole('tab', { name: 'Test' }))
}
const generate = async () => userEvent.click(await screen.findByRole('button', { name: 'Generar' }))
const startQuiz = async () => userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
async function answerFirst() {
  await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
  await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
  await screen.findByRole('region', { name: 'Corrección' })
}

describe('Test dentro de la app', () => {
  it('"Ver en apuntes" cambia a Apuntes, abre el documento y resalta el fragmento de la cita', async () => {
    const api = setup()
    await openTest()
    await generate()
    await startQuiz()
    await answerFirst()
    await userEvent.click(screen.getByRole('button', { name: 'Ver en apuntes' }))
    expect(screen.getByRole('tab', { name: 'Apuntes' })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel', { name: 'Apuntes' })
    await waitFor(() => expect(panel.querySelector('#chunk-11')).toHaveClass('chunk--focused'))
    expect(panel.querySelector('#chunk-11')).toHaveFocus()
    expect(panel.querySelector('#chunk-10')).not.toHaveClass('chunk--focused')
    expect(api.notes.chunks).toHaveBeenCalled()
  })

  it('si el fragmento está en otro documento, abre ese documento', async () => {
    const chunks = vi.fn((_s: number, documentId?: number) => okR(documentId === 2 ? [{ ...chunk(11, 'La célula es la unidad básica de la vida'), documentId: 2 }] : [chunk(10, 'otro')]))
    const api = installApi({
      subjects: { list: twoSubjects },
      notes: {
        list: vi.fn(() => okR([doc(), doc({ id: 2, title: 'Segundo' })])),
        chunks: chunks as never,
        chunk: vi.fn(() => okR({ id: 11, documentId: 2, documentTitle: 'Segundo', position: 0, text: 'x' }))
      },
      quiz: { generate: vi.fn(() => okR(outcome([vfQ()]))), startAttempt: vi.fn(() => okR({ attemptId: 5 })), submit: vi.fn(() => okR(grade())), onProgress: vi.fn(() => () => {}) } as never
    })
    Element.prototype.scrollIntoView = vi.fn()
    await openTest()
    await generate()
    await startQuiz()
    await answerFirst()
    await userEvent.click(screen.getByRole('button', { name: 'Ver en apuntes' }))
    const panel = screen.getByRole('tabpanel', { name: 'Apuntes' })
    await waitFor(() => expect(panel.querySelector('#chunk-11')).toHaveClass('chunk--focused'))
    expect(api.notes.chunks).toHaveBeenCalledWith(7, 2)
  })

  it('cambiar de asignatura durante un intento pide confirmación: cancelar conserva el intento', async () => {
    setup()
    await openTest()
    await generate()
    await startQuiz()
    await userEvent.click(screen.getByRole('radio', { name: 'Falso' }))
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/test en curso/)
    expect(dialog).toHaveTextContent(/historial/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Biología', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Falso' })).toBeChecked() // respuesta en curso intacta
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Cambiar y perder/ }))
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
  })

  it('cambiar de asignatura mientras genera pide confirmación y, al aceptar, cancela la generación', async () => {
    const gen = deferred<never>()
    const api = setup({ generate: vi.fn(() => gen.promise) })
    await openTest()
    await generate()
    await screen.findByRole('progressbar')
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/generación de preguntas en curso/)
    expect(dialog).not.toHaveTextContent(/intento|respuestas/)
    expect(api.quiz.cancel).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Cambiar y perder/ }))
    expect(api.quiz.cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
  })

  it('con el test terminado o sin empezar, cambiar de asignatura no pregunta', async () => {
    setup()
    await openTest()
    await generate()
    await startQuiz()
    await answerFirst()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    await screen.findByText('1 de 1')
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
  })

  it('"Ver historial" abre la pestaña Historial con el intento recién hecho', async () => {
    const history = vi.fn(() =>
      okR([{ id: 5, startedAt: '2026-10-22T10:00:00Z', finishedAt: '2026-10-22T10:05:00Z', answers: [{ questionId: 1, prompt: 'P', type: 'vf', userAnswer: 'verdadero', correct: true, feedback: 'F', feedbackQuote: 'q' }] }])
    )
    setup({}, history)
    await openTest()
    await generate()
    await startQuiz()
    await answerFirst()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver historial' }))
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('button', { name: /1\/1/ })).toBeVisible()
  })
})
