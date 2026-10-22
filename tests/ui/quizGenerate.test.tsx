// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TestTab from '../../src/renderer/src/views/TestTab'
import { doc, installApi } from './fakeApi'
import { deferred, devQ, failR, okR, outcome, progressHarness, testQ, vfQ } from './quizFixtures'

const subject = { id: 7, name: 'Biología' }
const docs = vi.fn(() => okR([doc({ id: 1, title: 'Apuntes de célula' }), doc({ id: 2, title: 'Foto vacía', chunkCount: 0 })]))

function setup(quiz: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const harness = progressHarness()
  const api = installApi({
    notes: { list: docs },
    quiz: { onProgress: harness.onProgress, cancel: vi.fn(() => okR({ cancelled: true })), startAttempt: vi.fn(() => okR({ attemptId: 5 })), ...quiz } as never,
    ...extra
  })
  render(<TestTab subject={subject} />)
  return { api, harness }
}

const countInput = () => screen.getByLabelText(/Número de preguntas/)

describe('Test: formulario', () => {
  it('muestra tipo, número (por defecto 5), documento, tema y el aviso de lentitud en CPU', async () => {
    setup()
    expect(screen.getByRole('radio', { name: 'Verdadero/Falso' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Tipo test' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Desarrollar' })).toBeInTheDocument()
    expect(countInput()).toHaveValue(5)
    const select = await screen.findByLabelText(/Documento/)
    // solo documentos con fragmentos
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Todos los documentos', 'Apuntes de célula'])
    expect(screen.getByLabelText(/Tema/)).toBeInTheDocument()
    expect(screen.getByText(/puede tardar varios minutos/)).toBeInTheDocument()
  })

  it.each(['0', '21', '2.5', '', '-3'])('el número %j no es válido: avisa y no llama a generate', async (value) => {
    const { api } = setup()
    const input = countInput()
    await userEvent.clear(input)
    if (value) await userEvent.type(input, value)
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/entre 1 y 20/)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(api.quiz.generate).not.toHaveBeenCalled()
  })

  it.each(['1', '20'])('los límites %s son válidos', async (value) => {
    const { api } = setup({ generate: vi.fn(() => new Promise(() => {})) })
    await userEvent.clear(countInput())
    await userEvent.type(countInput(), value)
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(api.quiz.generate).toHaveBeenCalledWith(expect.objectContaining({ count: Number(value), subjectId: 7, type: 'vf' }))
  })

  it('envía tipo, documento y tema con un requestId nuevo en cada generación', async () => {
    const generate = vi.fn(() => okR(outcome([vfQ()])))
    setup({ generate })
    await userEvent.click(screen.getByRole('radio', { name: 'Tipo test' }))
    await userEvent.selectOptions(await screen.findByLabelText(/Documento/), 'Apuntes de célula')
    await userEvent.type(screen.getByLabelText(/Tema/), '  membrana  ')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generar otras' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generar' }))
    const [a, b] = generate.mock.calls.map((c) => (c as unknown as [{ requestId: string }])[0])
    expect(a).toMatchObject({ type: 'test', count: 5, documentId: 1, topic: 'membrana', subjectId: 7 })
    expect(a?.requestId).toBeTruthy()
    expect(b?.requestId).not.toBe(a?.requestId)
  })

  it('sin apuntes con texto explica que primero hay que importar y no deja generar', async () => {
    setup({}, { notes: { list: vi.fn(() => okR([])) } })
    expect(await screen.findByText(/aún no tiene apuntes con texto/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled()
  })
})

describe('Test: progreso y cancelación', () => {
  it('la barra de progreso sigue los eventos y Cancelar llama a quiz.cancel con el requestId', async () => {
    const gen = deferred<Awaited<ReturnType<typeof okR>>>()
    const { api, harness } = setup({ generate: vi.fn(() => gen.promise) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    const bar = await screen.findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
    const { requestId } = (api.quiz.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { requestId: string }
    act(() => harness.emit({ requestId: 'otra-peticion', done: 4, total: 5 }))
    expect(bar).toHaveAttribute('aria-valuenow', '0') // evento de otra petición: ignorado
    act(() => harness.emit({ requestId, done: 2, total: 5 }))
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByText('2 de 5 preguntas')).toBeInTheDocument()
    act(() => harness.emit({ requestId, done: 3, total: 5 }))
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    // el formulario no se puede tocar mientras genera
    expect(screen.queryByRole('button', { name: 'Generar' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(api.quiz.cancel).toHaveBeenCalledWith(requestId)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await act(async () => gen.resolve({ ok: true, data: outcome([vfQ(), vfQ({ id: 9 })]) }))
    expect(harness.listeners.size).toBe(0) // suscripción cerrada
  })

  it('al cancelar conserva las preguntas ya generadas y lo dice', async () => {
    const gen = deferred<Awaited<ReturnType<typeof okR>>>()
    setup({ generate: vi.fn(() => gen.promise) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await act(async () => gen.resolve({ ok: true, data: outcome([vfQ(), vfQ({ id: 9 })]) }))
    expect(await screen.findByText(/Generación cancelada/)).toHaveTextContent('Se conservaron 2 preguntas ya generadas')
    expect(screen.getByRole('button', { name: 'Empezar el test' })).toBeEnabled()
  })

  it('cancelar sin ninguna pregunta lo dice y no ofrece empezar', async () => {
    const gen = deferred<Awaited<ReturnType<typeof okR>>>()
    setup({ generate: vi.fn(() => gen.promise) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await act(async () => gen.resolve({ ok: true, data: outcome([]) }))
    expect(await screen.findByText(/Generación cancelada/)).toHaveTextContent('Todavía no se había generado ninguna pregunta')
    expect(screen.queryByRole('button', { name: 'Empezar el test' })).not.toBeInTheDocument()
    expect(screen.queryByText(/No hay material suficiente/)).not.toBeInTheDocument()
  })

  it('si la cancelación falla muestra el error y deja volver a intentarlo', async () => {
    const cancel = vi.fn(() => failR('No se pudo cancelar'))
    setup({ generate: vi.fn(() => new Promise(() => {})), cancel })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cancelar')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled())
  })

  it('al desmontar durante la generación se cancela la petición en main', async () => {
    const harness = progressHarness()
    const api = installApi({ notes: { list: docs }, quiz: { onProgress: harness.onProgress, generate: vi.fn(() => new Promise(() => {})), cancel: vi.fn(() => okR({ cancelled: true })) } as never })
    const { unmount } = render(<TestTab subject={subject} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    const { requestId } = (api.quiz.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { requestId: string }
    unmount()
    expect(api.quiz.cancel).toHaveBeenCalledWith(requestId)
  })

  it('avisa del bloqueo mientras genera y lo quita al terminar', async () => {
    const gen = deferred<Awaited<ReturnType<typeof okR>>>()
    const harness = progressHarness()
    installApi({ notes: { list: docs }, quiz: { onProgress: harness.onProgress, generate: vi.fn(() => gen.promise) } as never })
    const onBlockingChange = vi.fn()
    render(<TestTab subject={subject} onBlockingChange={onBlockingChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith('generating'))
    await act(async () => gen.resolve({ ok: true, data: outcome([vfQ()]) }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith(null))
  })
})

describe('Test: resultado de la generación', () => {
  it('insufficient sin preguntas → "No hay material suficiente en tus apuntes para ese tema"', async () => {
    setup({ generate: vi.fn(() => okR(outcome([], { insufficient: true }))) })
    await userEvent.type(screen.getByLabelText(/Tema/), 'física cuántica')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText('No hay material suficiente en tus apuntes para ese tema')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Empezar el test' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Volver al formulario' }))
    expect(screen.getByRole('button', { name: 'Generar' })).toBeInTheDocument()
  })

  it('discarded > 0 avisa con el número y la lista de motivos en texto plano', async () => {
    const reasons = ['Pregunta 2: la cita no aparece en el fragmento', `Pregunta 3: ${'<b>x</b>'}`]
    setup({ generate: vi.fn(() => okR(outcome([vfQ()], { discarded: 2, reasons }))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText('Se descartaron 2 preguntas que no se pudieron respaldar con tus apuntes.')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Motivos del descarte' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(reasons)
    expect(document.body.querySelector('b')).toBeNull() // el marcado de un motivo no se interpreta
    expect(screen.getByRole('button', { name: 'Empezar el test' })).toBeInTheDocument()
  })

  it('singular: "Se descartó 1 pregunta"', async () => {
    setup({ generate: vi.fn(() => okR(outcome([vfQ()], { discarded: 1, reasons: ['x'] }))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText(/Se descartó 1 pregunta que no se pudo respaldar/)).toBeInTheDocument()
  })

  it('nunca muestra ni cuenta una pregunta sin cita: se descarta y se explica', async () => {
    setup({ generate: vi.fn(() => okR(outcome([vfQ(), vfQ({ id: 8, quote: '   ' }), vfQ({ id: undefined })]))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText(/Se generó 1 pregunta/)).toBeInTheDocument()
    expect(screen.getByText(/Se descartaron 2 preguntas/)).toBeInTheDocument()
    expect(screen.getByText(/2 preguntas sin cita no se muestran/)).toBeInTheDocument()
  })

  it('sin preguntas, sin descartes y sin insufficient → línea genérica', async () => {
    setup({ generate: vi.fn(() => okR(outcome([]))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText('No se generó ninguna pregunta. Prueba otra vez o cambia el tema.')).toBeInTheDocument()
    expect(screen.queryByText(/No hay material suficiente/)).not.toBeInTheDocument()
  })

  it('el foco pasa al resultado al terminar', async () => {
    setup({ generate: vi.fn(() => okR(outcome([vfQ()]))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Resultado de la generación' })).toHaveFocus())
  })
})

describe('Test: errores', () => {
  it('ok:false de generate muestra un Alert y vuelve al formulario', async () => {
    setup({ generate: vi.fn(() => failR('El modelo no respondió')) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('El modelo no respondió')
    expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled()
  })

  it('con Ollama caído, el mensaje de salud va primero', async () => {
    setup(
      { generate: vi.fn(() => failR('Fallo al generar')) },
      { system: { health: vi.fn(() => okR({ ok: false, message: 'No se pudo conectar con Ollama.', model: 'm' })) } }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^No se pudo conectar con Ollama\. Fallo al generar$/)
  })

  it('Generar funciona aunque Ollama figure caído (la salud solo se consulta si falla)', async () => {
    const health = vi.fn(() => okR({ ok: false, message: 'caído', model: 'm' }))
    const { api } = setup({ generate: vi.fn(() => okR(outcome([vfQ()]))) }, { system: { health } })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByText(/Se generó 1 pregunta/)).toBeInTheDocument()
    expect(api.quiz.generate).toHaveBeenCalled()
    expect(health).not.toHaveBeenCalled()
  })

  it('si generate rechaza la promesa muestra el error genérico', async () => {
    setup({ generate: vi.fn(() => Promise.reject(new Error('boom'))) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/)
  })

  it('un error de cancelación no sigue visible cuando la generación termina bien', async () => {
    const gen = deferred<Awaited<ReturnType<typeof okR>>>()
    setup({ generate: vi.fn(() => gen.promise), cancel: vi.fn(() => failR('No se pudo cancelar')) })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cancelar')
    await act(async () => gen.resolve({ ok: true, data: outcome([vfQ()]) }))
    await screen.findByText(/Se generó 1 pregunta/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ok:false de startAttempt muestra un Alert y se puede reintentar', async () => {
    const startAttempt = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Base de datos bloqueada' }).mockResolvedValue({ ok: true, data: { attemptId: 5 } })
    setup({ generate: vi.fn(() => okR(outcome([vfQ(), testQ(), devQ()]))), startAttempt })
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar el test' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Base de datos bloqueada')
    await userEvent.click(screen.getByRole('button', { name: 'Empezar el test' }))
    expect(await screen.findByRole('heading', { name: 'Pregunta 1 de 3' })).toBeInTheDocument()
  })
})
