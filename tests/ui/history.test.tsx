// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryTab from '../../src/renderer/src/views/HistoryTab'
import type { HistoryAnswer, HistoryAttempt } from '../../src/shared/api'
import { installApi } from './fakeApi'
import { okR, XSS } from './quizFixtures'

const subject = { id: 7, name: 'Biología' }
const answer = (over: Partial<HistoryAnswer> = {}): HistoryAnswer => ({
  questionId: 1,
  prompt: '¿Qué es la célula?',
  type: 'desarrollo',
  userAnswer: 'La unidad de la vida',
  correct: true,
  feedback: 'Bien explicado.',
  feedbackQuote: 'La célula es la unidad básica',
  ...over
})
const attempt = (over: Partial<HistoryAttempt> = {}): HistoryAttempt => ({
  id: 1,
  startedAt: '2026-10-22T14:05:00.000Z',
  finishedAt: '2026-10-22T14:10:00.000Z',
  answers: [answer(), answer({ questionId: 2, correct: false, prompt: 'Otra', userAnswer: 'No lo sé', feedback: 'Mal', feedbackQuote: '' })],
  ...over
})

describe('Historial', () => {
  it('lista los intentos con fecha, nota X/N y nº de preguntas, el más reciente primero', async () => {
    installApi({ history: { list: vi.fn(() => okR([attempt({ id: 1 }), attempt({ id: 2, answers: [answer()] })])) } })
    render(<HistoryTab subject={subject} />)
    const list = await screen.findByRole('list', { name: 'Intentos' })
    const items = list.querySelectorAll(':scope > li')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('1/1')
    expect(items[0]).toHaveTextContent('1 pregunta')
    expect(items[1]).toHaveTextContent('1/2')
    expect(items[1]).toHaveTextContent('2 preguntas')
    expect(items[1]).toHaveTextContent(/2026/)
  })

  it('un intento sin terminar se marca', async () => {
    installApi({ history: { list: vi.fn(() => okR([attempt({ finishedAt: null })])) } })
    render(<HistoryTab subject={subject} />)
    expect(await screen.findByText('Sin terminar')).toBeInTheDocument()
  })

  it('el detalle se despliega con pregunta, tu respuesta, veredicto, feedback y cita', async () => {
    installApi({ history: { list: vi.fn(() => okR([attempt()])) } })
    render(<HistoryTab subject={subject} />)
    const toggle = await screen.findByRole('button', { name: /1\/2/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('¿Qué es la célula?')).not.toBeVisible()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('¿Qué es la célula?')).toBeVisible()
    expect(screen.getByText('La unidad de la vida')).toBeVisible()
    const regions = screen.getAllByRole('region', { name: 'Corrección' })
    expect(within(regions[0]!).getByText('Correcto')).toBeVisible()
    expect(within(regions[1]!).getByText('Incorrecto')).toBeVisible()
    expect(within(regions[0]!).getByTestId('feedback')).toHaveTextContent('Bien explicado.')
    expect(regions[0]).toHaveTextContent('Fragmento de origen')
    expect(regions[0]).toHaveTextContent('La célula es la unidad básica')
    // segunda respuesta: sin cita guardada → no hay bloque de cita
    expect(within(regions[1]!).queryByLabelText('Fragmento de origen')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.getByText('¿Qué es la célula?')).not.toBeVisible()
  })

  it('el historial no inventa verificación: ni insignia ni "No se pudo verificar" ni enlace', async () => {
    installApi({ history: { list: vi.fn(() => okR([attempt()])) } })
    render(<HistoryTab subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /1\/2/ }))
    expect(screen.queryByText(/verificad/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No se pudo verificar/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver en apuntes' })).not.toBeInTheDocument()
  })

  it('el texto con marcado se muestra literal', async () => {
    installApi({
      history: { list: vi.fn(() => okR([attempt({ answers: [answer({ prompt: `P ${XSS}`, userAnswer: `R ${XSS}`, feedback: `F ${XSS}`, feedbackQuote: `C ${XSS}` })] })])) }
    })
    const { container } = render(<HistoryTab subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /1\/1/ }))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(`P ${XSS}`)).toBeInTheDocument()
    expect(screen.getByTestId('feedback').textContent).toBe(`F ${XSS}`)
  })

  it('una pregunta borrada (enunciado vacío) se indica', async () => {
    installApi({ history: { list: vi.fn(() => okR([attempt({ answers: [answer({ prompt: '' })] })])) } })
    render(<HistoryTab subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /1\/1/ }))
    expect(screen.getByText('La pregunta ya no está disponible.')).toBeInTheDocument()
  })

  it('estado vacío cuando no hay intentos', async () => {
    installApi({ history: { list: vi.fn(() => okR([])) } })
    render(<HistoryTab subject={subject} />)
    expect(await screen.findByText(/Todavía no has hecho ningún test/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Intentos' })).not.toBeInTheDocument()
  })

  it('ok:false muestra un Alert y Reintentar vuelve a pedirlo', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Base de datos bloqueada' }).mockResolvedValue({ ok: true, data: [attempt()] })
    installApi({ history: { list } })
    render(<HistoryTab subject={subject} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Base de datos bloqueada')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('list', { name: 'Intentos' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('si la llamada rechaza la promesa muestra el error genérico', async () => {
    installApi({ history: { list: vi.fn(() => Promise.reject(new Error('x'))) } })
    render(<HistoryTab subject={subject} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/)
  })

  it('no carga mientras la pestaña está oculta y recarga cada vez que se muestra', async () => {
    const list = vi.fn(() => okR([attempt()]))
    installApi({ history: { list } })
    const { rerender } = render(<HistoryTab subject={subject} active={false} />)
    expect(list).not.toHaveBeenCalled()
    rerender(<HistoryTab subject={subject} active />)
    await screen.findByRole('list', { name: 'Intentos' })
    expect(list).toHaveBeenCalledTimes(1)
    rerender(<HistoryTab subject={subject} active={false} />)
    rerender(<HistoryTab subject={subject} active />)
    await screen.findByRole('list', { name: 'Intentos' })
    expect(list).toHaveBeenCalledTimes(2)
  })
})
