// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beginQuiz, devQ, grade, okR, testQ, vfQ } from './quizFixtures'

const rejected = () => Promise.resolve({ ok: false as const, error: 'La pregunta no existe en esta asignatura.' })

describe('Salidas del test', () => {
  it('si submit se rechaza siempre, se puede terminar aquí (dos pasos, sin diálogo) y se ve la nota de lo respondido', async () => {
    const { api } = await beginQuiz([vfQ(), testQ()], rejected)
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no existe')
    await userEvent.click(screen.getByRole('button', { name: 'Terminar el test aquí' }))
    // primer paso: solo pide confirmar, todavía no cierra y no abre ningún diálogo
    expect(api.quiz.finishAttempt).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: '¿Seguro? Confirmar' })
    expect(confirm).toHaveFocus()
    await userEvent.click(confirm)
    expect(api.quiz.finishAttempt).toHaveBeenCalledWith(7, 5)
    expect(await screen.findByText('0 de 0 respondidas')).toBeInTheDocument()
    expect(screen.getByText(/2 preguntas sin responder/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver historial' })).toBeInTheDocument()
  })

  it('"No, seguir" cancela la confirmación y devuelve el foco', async () => {
    const { api } = await beginQuiz([vfQ()], () => okR(grade()))
    await userEvent.click(screen.getByRole('button', { name: 'Terminar el test aquí' }))
    await userEvent.click(screen.getByRole('button', { name: 'No, seguir' }))
    expect(api.quiz.finishAttempt).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '¿Seguro? Confirmar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Terminar el test aquí' })).toHaveFocus()
  })

  it('termina a mitad: cuenta solo las respondidas ("1 de 1 respondidas")', async () => {
    await beginQuiz([vfQ(), testQ()], () => okR(grade()))
    await userEvent.click(screen.getByRole('radio', { name: 'Verdadero' }))
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
    await userEvent.click(screen.getByRole('button', { name: 'Terminar el test aquí' }))
    await userEvent.click(screen.getByRole('button', { name: '¿Seguro? Confirmar' }))
    expect(await screen.findByText('1 de 1 respondidas')).toBeInTheDocument()
    expect(screen.getByText(/1 pregunta sin responder/)).toBeInTheDocument()
  })

  it('si finishAttempt falla al terminar aquí muestra un Alert y se puede reintentar', async () => {
    const finishAttempt = vi.fn().mockResolvedValueOnce({ ok: false, error: 'No se pudo cerrar' }).mockResolvedValue({ ok: true, data: null })
    await beginQuiz([vfQ()], rejected, { finishAttempt })
    await userEvent.click(screen.getByRole('button', { name: 'Terminar el test aquí' }))
    await userEvent.click(screen.getByRole('button', { name: '¿Seguro? Confirmar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cerrar')
    // la confirmación sigue a la vista: basta volver a confirmar
    await userEvent.click(screen.getByRole('button', { name: '¿Seguro? Confirmar' }))
    expect(await screen.findByText('0 de 0 respondidas')).toBeInTheDocument()
  })

  it('"Saltar esta pregunta" pasa a la siguiente y cuenta como no respondida', async () => {
    const { api } = await beginQuiz([vfQ(), devQ()], () => okR(grade()))
    await userEvent.click(screen.getByRole('button', { name: 'Saltar esta pregunta' }))
    expect(screen.getByRole('heading', { name: 'Pregunta 2 de 2' })).toHaveFocus()
    await userEvent.type(screen.getByRole('textbox'), 'respuesta')
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    await screen.findByRole('region', { name: 'Corrección' })
    await userEvent.click(screen.getByRole('button', { name: 'Terminar y ver la nota' }))
    expect(api.quiz.finishAttempt).toHaveBeenCalled()
    expect(await screen.findByText('1 de 1 respondidas')).toBeInTheDocument()
    expect(screen.getByText(/1 pregunta sin responder/)).toBeInTheDocument()
  })

  it('saltar la última pregunta termina el intento', async () => {
    const { api } = await beginQuiz([vfQ()], () => okR(grade()))
    await userEvent.click(screen.getByRole('button', { name: 'Saltar esta pregunta' }))
    expect(api.quiz.finishAttempt).toHaveBeenCalledWith(7, 5)
    expect(await screen.findByText('0 de 0 respondidas')).toBeInTheDocument()
  })

  it('una pregunta test con menos de 2 opciones avisa y se puede saltar', async () => {
    const submit = vi.fn(() => okR(grade()))
    await beginQuiz([testQ({ options: ['Única'] }), vfQ()], submit)
    expect(screen.getByRole('alert')).toHaveTextContent('Esta pregunta no tiene opciones válidas')
    expect(screen.getByRole('button', { name: 'Responder' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Saltar esta pregunta' }))
    expect(screen.getByRole('heading', { name: 'Pregunta 2 de 2' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })

  it('una pregunta test sin la propiedad options también se puede saltar', async () => {
    await beginQuiz([testQ({ options: undefined })], () => okR(grade()))
    expect(screen.getByRole('alert')).toHaveTextContent('Esta pregunta no tiene opciones válidas')
    expect(screen.getByRole('button', { name: 'Saltar esta pregunta' })).toBeEnabled()
  })

  it('con opciones duplicadas solo se marca la elegida y se envía su texto', async () => {
    const { api } = await beginQuiz([testQ({ options: ['Igual', 'Igual', 'Otra', 'Más'] })], () => okR(grade()))
    const radios = screen.getAllByRole('radio')
    await userEvent.click(radios[1]!)
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true, false, false])
    await userEvent.click(radios[0]!)
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false, false])
    await userEvent.click(screen.getByRole('button', { name: 'Responder' }))
    expect(api.quiz.submit).toHaveBeenCalledWith(expect.objectContaining({ answer: 'Igual' }))
  })
})
