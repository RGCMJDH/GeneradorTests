// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Notes from '../../src/renderer/src/views/Notes'
import OcrReview from '../../src/renderer/src/views/OcrReview'
import Diagnostics from '../../src/renderer/src/views/Diagnostics'
import Subjects from '../../src/renderer/src/views/Subjects'
import { ErrorBoundary } from '../../src/renderer/src/components/ErrorBoundary'
import { boot } from '../../src/renderer/src/boot'
import { doc, installApi } from './fakeApi'

const reject = () => vi.fn(() => Promise.reject(new Error('IPC roto')))
const subject = { id: 7, name: 'Biología' }

describe('S1: una promesa rechazada no bloquea la interfaz', () => {
  it('Notes.importFile', async () => {
    installApi({ notes: { import: reject() as never } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar PDF/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/i)
    expect(screen.getByRole('button', { name: /Importar PDF/ })).toBeEnabled()
  })

  it('Notes: borrar', async () => {
    installApi({ notes: { list: vi.fn(async () => ({ ok: true as const, data: [doc()] })), deleteDocument: reject() as never } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Apuntes de célula' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/i)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eliminar Apuntes de célula' })).toBeEnabled()
  })

  it('OcrReview.confirm', async () => {
    installApi({ notes: { confirmOcr: reject() as never } })
    render(<OcrReview subjectId={7} documentId={9} initialText="x" onConfirmed={vi.fn()} onDiscarded={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/i)
    expect(screen.getByRole('button', { name: 'Confirmar y trocear' })).toBeEnabled()
    expect(screen.getByLabelText(/Texto reconocido/)).toBeEnabled()
  })

  it('Diagnostics.retry', async () => {
    const health = vi.fn().mockResolvedValueOnce({ ok: true, data: { ok: false, message: 'caído', model: 'm' } }).mockImplementation(() => Promise.reject(new Error('x')))
    installApi({ system: { health } })
    render(<Diagnostics />)
    await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo comprobar/)
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled()
  })

  it('Subjects.create', async () => {
    installApi({ subjects: { create: reject() as never } })
    render(<Subjects selectedId={null} onSelect={vi.fn()} />)
    await userEvent.type(await screen.findByLabelText('Nombre de la asignatura'), 'Física')
    await userEvent.click(screen.getByRole('button', { name: 'Crear asignatura' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/error inesperado/i)
    expect(screen.getByRole('button', { name: 'Crear asignatura' })).toBeEnabled()
    expect(screen.getByLabelText('Nombre de la asignatura')).toHaveValue('Física')
  })
})

describe('S3: arranque sin puente y error boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    delete (window as unknown as { api?: unknown }).api
  })

  it('sin window.api en producción muestra una pantalla de error en español', async () => {
    vi.stubEnv('DEV', false)
    delete (window as unknown as { api?: unknown }).api
    const el = document.body.appendChild(document.createElement('div'))
    const root = await act(() => boot(el))
    expect(within(el).getByRole('alert')).toHaveTextContent(/No se pudo cargar el puente de la aplicación/)
    expect(within(el).getByRole('alert')).toHaveTextContent(/reinicia/i)
    act(() => root.unmount())
    el.remove()
  })

  it('en desarrollo sin window.api instala el mock y arranca la app', async () => {
    delete (window as unknown as { api?: unknown }).api
    const el = document.body.appendChild(document.createElement('div'))
    const root = await act(() => boot(el))
    expect(await within(el).findByText(/Elige o crea una asignatura/)).toBeInTheDocument()
    expect(typeof window.api).toBe('object')
    act(() => root.unmount())
    el.remove()
  })

  it('el error boundary muestra un mensaje con botón Recargar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReload = vi.fn()
    const Bomb = (): never => {
      throw new Error('boom')
    }
    render(
      <ErrorBoundary onReload={onReload}>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Algo ha fallado/)
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(onReload).toHaveBeenCalledOnce()
    spy.mockRestore()
  })
})
