// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TestTab from '../../src/renderer/src/views/TestTab'
import type { GradeResultDto, Question } from '../../src/shared/api'
import { doc, installApi } from './fakeApi'
import { deferred, devQ, failR, grade, okR, outcome, testQ, vfQ, XSS } from './quizFixtures'

const subject = { id: 7, name: 'Biología' }

async function begin(questions: Question[], submit: (...a: never[]) => unknown, extra: Record<string, unknown> = {}) {
  const api = installApi({
    notes: { list: vi.fn(() => okR([doc()])) },
    quiz: {
      generate: vi.fn(() => okR(outcome(questions))),
      startAttempt: vi.fn(() => okR({ attemptId: 5 })),
      finishAttempt: vi.fn(() => okR(null)),
      submit: vi.fn(submit),
      ...extra
    } as never
  })
  const onShowHistory = vi.fn()
  const view = render(<TestTab subject={subject} onShowHistory={onShowHistory} />)
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
  await screen.findByRole('heading', { name: /^Pregunta 1 de/ })
  return { api, onShowHistory, view }
}

const feedbackEl = () => screen.getByTestId('feedback')

describe('QuestionCard por tipo', () => {
  it('Verdadero/Falso: dos radios, Responder deshabilitado hasta elegir, envía "verdadero"', async () => {
    const { api } = await begin([vfQ()], () => okR(grade()))
    expect(screen.getByRole('heading', { name: 'Pregunta 1 de 1' })).toHaveFocus()
    expect(screen.getByRole('group', { name: 'La célula es la unidad básica de los seres vivos.' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['Verdadero', 'Falso'])
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(api.quiz.submit).toHaveBeenCalledWith({ subjectId: 7, attemptId: 5, questionId: 1, answer: 'verdadero' })
  })

  it('Tipo test: una opción por radio y envía el texto de la opción', async () => {
    const { api } = await begin([testQ()], () => okR(grade({ correct: false, feedback: 'Incorrecto. La respuesta correcta es: La membrana.' })))
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    await userEvent.click(screen.getByRole('radio', { name: 'El núcleo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(api.quiz.submit).toHaveBeenCalledWith(expect.objectContaining({ questionId: 2, answer: 'El núcleo' }))
    expect(await screen.findByText('Incorrecto')).toBeInTheDocument()
  })

  it('Desarrollar: textarea de máx. 20000 caracteres; con solo espacios no se puede enviar', async () => {
    const { api } = await begin([devQ()], () => okR(grade()))
    const box = screen.getByLabelText('Explica qué hacen las mitocondrias.')
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute('maxlength', '20000')
    await userEvent.type(box, '   ')
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDisabled()
    await userEvent.type(box, 'Producen ATP')
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(api.quiz.submit).toHaveBeenCalledWith(expect.objectContaining({ answer: '   Producen ATP' }))
  })
})

describe('Corrección', () => {
  it('correcto: veredicto, feedback en texto plano, anuncio en la región aria-live y foco en la corrección', async () => {
    await begin([vfQ()], () => okR(grade()))
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    const region = await screen.findByRole('region', { name: 'Corrección' })
    expect(within(region).getByText('Correcto')).toBeInTheDocument()
    expect(feedbackEl()).toHaveTextContent('Correcto. Está en el fragmento.')
    await waitFor(() => expect(region).toHaveFocus())
    const live = screen.getAllByRole('status').find((s) => s.getAttribute('aria-live') === 'polite' && s.textContent === 'Respuesta correcta.')
    expect(live).toBeDefined()
    // los controles quedan bloqueados tras responder
    expect(screen.getByRole('radio', { name: 'Falso' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument()
  })

  it('incorrecto: lo dice y anuncia "Respuesta incorrecta."', async () => {
    await begin([vfQ()], () => okR(grade({ correct: false, feedback: 'Incorrecto. La respuesta correcta es: verdadero.' })))
    await userEvent.click(screen.getByRole('radio', { name: 'Falso' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    const region = await screen.findByRole('region', { name: 'Corrección' })
    expect(within(region).getByText('Incorrecto')).toBeInTheDocument()
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Respuesta incorrecta.')).toBe(true)
  })

  it('mientras se corrige deshabilita los controles y muestra el estado ocupado', async () => {
    const d = deferred<{ ok: true; data: GradeResultDto }>()
    await begin([devQ()], () => d.promise)
    await userEvent.type(screen.getByRole('textbox'), 'respuesta larga y razonada')
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDisabled()
    expect(screen.getByText(/Corrigiendo tu respuesta/)).toBeInTheDocument()
    d.resolve({ ok: true, data: grade() })
    await screen.findByRole('region', { name: 'Corrección' })
    expect(screen.queryByText(/Corrigiendo/)).not.toBeInTheDocument()
  })

  it('ok:false de submit muestra un Alert, permite reintentar y no revela la corrección', async () => {
    const submit = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Esta pregunta ya está respondida' }).mockResolvedValue({ ok: true, data: grade() })
    await begin([vfQ()], submit)
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta pregunta ya está respondida')
    expect(screen.queryByRole('region', { name: 'Corrección' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Responder' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(await screen.findByRole('region', { name: 'Corrección' })).toBeInTheDocument()
  })

  it('si submit rechaza la promesa muestra el error genérico y vuelve a habilitar', async () => {
    await begin([vfQ()], () => Promise.reject(new Error('boom')))
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/)
    expect(screen.getByRole('button', { name: 'Responder' })).toBeEnabled()
  })

  it('el marcador "(cita del modelo no verificada)" del feedback se ve como texto', async () => {
    await begin([devQ()], () => okR(grade({ feedback: 'Bien explicado. (cita del modelo no verificada)', quote: '', verified: false })))
    await userEvent.type(screen.getByRole('textbox'), 'algo')
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
    expect(feedbackEl()).toHaveTextContent('Bien explicado. (cita del modelo no verificada)')
  })
})

describe('Cita y verificación', () => {
  const answerVf = async () => {
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
  }

  it('verified:true → bloque "Fragmento de origen" con la cita y la insignia, solo dentro del bloque de la cita', async () => {
    await begin([vfQ()], () => okR(grade({ verified: true })))
    await answerVf()
    const quote = screen.getByLabelText('Fragmento de origen', { selector: 'aside' })
    expect(quote).toHaveTextContent('La célula es la unidad básica')
    const badge = within(quote).getByText('Cita verificada en tus apuntes')
    expect(quote).toContainElement(badge)
    expect(screen.getAllByText('Cita verificada en tus apuntes')).toHaveLength(1)
    // nunca en el feedback
    expect(feedbackEl()).not.toContainElement(badge)
    expect(feedbackEl().textContent).not.toMatch(/verificad/i)
    expect(feedbackEl().querySelector('*')).toBeNull()
    expect(screen.getByText(/no garantiza que la corrección sea acertada/)).toBeInTheDocument()
  })

  it('verified:false → "No se pudo verificar la cita" y ninguna insignia', async () => {
    await begin([vfQ()], () => okR(grade({ verified: false, quote: 'cita sin comprobar' })))
    await answerVf()
    expect(screen.queryByText('Cita verificada en tus apuntes')).not.toBeInTheDocument()
    expect(screen.queryByText(/verificada en tus apuntes/i)).not.toBeInTheDocument()
    const quote = screen.getByLabelText('Fragmento de origen', { selector: 'aside' })
    expect(within(quote).getByText('No se pudo verificar la cita')).toBeInTheDocument()
    expect(quote).toHaveTextContent('cita sin comprobar')
  })

  it('verified:false con cita vacía → sin texto de cita, sin insignia, con aviso y enlace al fragmento', async () => {
    await begin([vfQ()], () => okR(grade({ verified: false, quote: '' })))
    await answerVf()
    const quote = screen.getByLabelText('Fragmento de origen', { selector: 'aside' })
    expect(quote.querySelector('blockquote')).toBeNull()
    expect(screen.queryByText('Cita verificada en tus apuntes')).not.toBeInTheDocument()
    expect(within(quote).getByText('No se pudo verificar la cita')).toBeInTheDocument()
    expect(within(quote).getByRole('button', { name: 'Ver en apuntes' })).toBeInTheDocument()
  })

  it('"Ver en apuntes" pide enfocar el fragmento de la pregunta', async () => {
    const { ChunkFocusProvider } = await import('../../src/renderer/src/chunkFocus')
    const onReveal = vi.fn()
    installApi({
      notes: { list: vi.fn(() => okR([doc()])) },
      quiz: {
        generate: vi.fn(() => okR(outcome([vfQ({ chunkId: 42 })]))),
        startAttempt: vi.fn(() => okR({ attemptId: 5 })),
        submit: vi.fn(() => okR(grade()))
      } as never
    })
    render(
      <ChunkFocusProvider onReveal={onReveal}>
        <TestTab subject={subject} />
      </ChunkFocusProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
    await answerVf()
    await userEvent.click(screen.getByRole('button', { name: 'Ver en apuntes' }))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })
})

describe('XSS: todo es texto', () => {
  it('prompt, opciones, feedback y cita con marcado se pintan como texto y no crean elementos', async () => {
    const q = testQ({
      prompt: `P ${XSS} <script>alert(1)</script>`,
      options: [`A ${XSS}`, '<b>B</b>', 'C', 'D']
    })
    const { view } = await begin([q], () =>
      okR(grade({ correct: false, feedback: `Mal ${XSS} <b>negrita</b>`, quote: `Cita ${XSS} <i>it</i>`, verified: true }))
    )
    const root = view.container
    expect(root.querySelector('img, script, b, i')).toBeNull()
    expect(screen.getByText(`P ${XSS} <script>alert(1)</script>`)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '<b>B</b>' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: `A ${XSS}` }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
    expect(feedbackEl().textContent).toBe(`Mal ${XSS} <b>negrita</b>`)
    expect(root.querySelector('blockquote')?.textContent).toBe(`Cita ${XSS} <i>it</i>`)
    expect(root.querySelector('img, script, b, i')).toBeNull()
  })
})

describe('Avance y nota final', () => {
  const three = [vfQ(), testQ(), devQ()]
  const answerCurrent = async () => {
    const radios = screen.queryAllByRole('radio')
    if (radios[0]) await userEvent.click(radios[0])
    else await userEvent.type(screen.getByRole('textbox'), 'respuesta')
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
  }

  it('una pregunta cada vez con "3 de 5": foco en el encabezado de cada pregunta nueva', async () => {
    await begin(three, () => okR(grade()))
    await answerCurrent()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente pregunta' }))
    const h = screen.getByRole('heading', { name: 'Pregunta 2 de 3' })
    await waitFor(() => expect(h).toHaveFocus())
    expect(screen.queryByRole('region', { name: 'Corrección' })).not.toBeInTheDocument() // la corrección anterior ya no está
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDisabled()
  })

  it('al final termina el intento y muestra "X de N" con los dos botones', async () => {
    const results = [grade(), grade({ correct: false, feedback: 'Mal' }), grade()]
    const submit = vi.fn()
    results.forEach((r) => submit.mockResolvedValueOnce({ ok: true, data: r }))
    const { api, onShowHistory } = await begin(three, submit)
    await answerCurrent()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente pregunta' }))
    await answerCurrent()
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente pregunta' }))
    await answerCurrent()
    expect(screen.queryByRole('button', { name: 'Siguiente pregunta' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    expect(api.quiz.finishAttempt).toHaveBeenCalledWith(7, 5)
    expect(await screen.findByText('2 de 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ver historial' }))
    expect(onShowHistory).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Repetir con otras preguntas' }))
    expect(await screen.findByRole('button', { name: 'Generar' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Verdadero/Falso' })).toHaveFocus())
  })

  it('si finishAttempt falla muestra un Alert y deja reintentar sin perder las respuestas', async () => {
    const finishAttempt = vi.fn().mockResolvedValueOnce({ ok: false, error: 'No se pudo cerrar' }).mockResolvedValue({ ok: true, data: null })
    await begin([vfQ()], () => okR(grade()), { finishAttempt })
    await answerCurrent()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cerrar')
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    expect(await screen.findByText('1 de 1')).toBeInTheDocument()
  })

  it('avisa del bloqueo durante el intento y lo quita al terminar', async () => {
    const onBlockingChange = vi.fn()
    installApi({
      notes: { list: vi.fn(() => okR([doc()])) },
      quiz: { generate: vi.fn(() => okR(outcome([vfQ()]))), startAttempt: vi.fn(() => okR({ attemptId: 5 })), submit: vi.fn(() => okR(grade())), finishAttempt: vi.fn(() => okR(null)) } as never
    })
    render(<TestTab subject={subject} onBlockingChange={onBlockingChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith('quiz'))
    await answerCurrent()
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    await screen.findByText('1 de 1')
    expect(onBlockingChange).toHaveBeenLastCalledWith(null)
  })
})
