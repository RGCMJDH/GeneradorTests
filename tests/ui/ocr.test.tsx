// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OcrReview from '../../src/renderer/src/views/OcrReview'
import { installApi } from './fakeApi'

const setup = (props: Partial<ComponentProps<typeof OcrReview>> = {}) => {
  const onConfirmed = vi.fn()
  const onDiscarded = vi.fn()
  render(<OcrReview subjectId={7} documentId={9} initialText="La celula es la unidad" onConfirmed={onConfirmed} onDiscarded={onDiscarded} {...props} />)
  return { onConfirmed, onDiscarded }
}

describe('OcrReview', () => {
  it('muestra siempre el aviso sobre la letra manuscrita', () => {
    installApi()
    setup()
    expect(screen.getByRole('note')).toHaveTextContent(/manuscrit/i)
    expect(screen.getByRole('note')).toHaveTextContent(/revis/i)
  })

  it('edita el texto y confirma con el texto corregido', async () => {
    const api = installApi({ notes: { confirmOcr: vi.fn(async () => ({ ok: true as const, data: { documentId: 9, chunkCount: 2, deletedQuestions: 0 } })) } })
    const { onConfirmed } = setup()
    const box = screen.getByLabelText(/Texto reconocido/)
    await userEvent.clear(box)
    await userEvent.type(box, 'La célula es la unidad básica')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(api.notes.confirmOcr).toHaveBeenCalledWith(9, 'La célula es la unidad básica')
    expect(onConfirmed).toHaveBeenCalledWith({ documentId: 9, chunkCount: 2, deletedQuestions: 0 })
  })

  it('no permite confirmar un texto vacío', async () => {
    installApi()
    setup()
    await userEvent.clear(screen.getByLabelText(/Texto reconocido/))
    expect(screen.getByRole('button', { name: 'Confirmar y trocear' })).toBeDisabled()
  })

  it('WOULD_DELETE_QUESTIONS: pide confirmación y solo entonces reintenta con force:true', async () => {
    const confirmOcr = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'Se borrarían preguntas', code: 'WOULD_DELETE_QUESTIONS', count: 4 })
      .mockResolvedValueOnce({ ok: true, data: { documentId: 9, chunkCount: 2, deletedQuestions: 4 } })
    installApi({ notes: { confirmOcr } })
    const { onConfirmed } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/se borrarán 4 preguntas ya generadas/)
    expect(confirmOcr).toHaveBeenCalledTimes(1)
    expect(onConfirmed).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: /borrar y continuar/i }))
    expect(confirmOcr).toHaveBeenCalledTimes(2)
    expect(confirmOcr).toHaveBeenLastCalledWith(9, 'La celula es la unidad', true)
    expect(onConfirmed).toHaveBeenCalledOnce()
  })

  it('WOULD_DELETE_QUESTIONS: cancelar no reintenta ni confirma', async () => {
    const confirmOcr = vi.fn().mockResolvedValue({ ok: false, error: 'x', code: 'WOULD_DELETE_QUESTIONS', count: 1 })
    installApi({ notes: { confirmOcr } })
    const { onConfirmed } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/1 pregunta ya generada/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(confirmOcr).toHaveBeenCalledTimes(1)
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('un error muestra role=alert y mantiene el texto editado', async () => {
    installApi({ notes: { confirmOcr: vi.fn(async () => ({ ok: false as const, error: 'No se pudo trocear', code: 'INTERNAL' as const })) } })
    setup()
    await userEvent.type(screen.getByLabelText(/Texto reconocido/), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo trocear')
    expect(screen.getByLabelText(/Texto reconocido/)).toHaveValue('La celula es la unidad!')
  })

  it('deshabilita controles mientras confirma', async () => {
    let release: (v: unknown) => void = () => {}
    installApi({
      notes: {
        confirmOcr: vi.fn(
          () =>
            new Promise((r) => {
              release = r
            })
        ) as never
      }
    })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(screen.getByRole('button', { name: /Troceando/ })).toBeDisabled()
    expect(screen.getByLabelText(/Texto reconocido/)).toBeDisabled()
    release({ ok: true, data: { documentId: 9, chunkCount: 1, deletedQuestions: 0 } })
  })

  it('descartar pide confirmación y borra el documento', async () => {
    const api = installApi()
    const { onDiscarded } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Descartar foto' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }))
    expect(api.notes.deleteDocument).toHaveBeenCalledWith(7, 9)
    expect(onDiscarded).toHaveBeenCalled()
  })
})
