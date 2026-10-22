// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Subjects from '../../src/renderer/src/views/Subjects'
import { installApi } from './fakeApi'

describe('Subjects (barra lateral)', () => {
  it('lista las asignaturas existentes y selecciona una', async () => {
    installApi({ subjects: { list: vi.fn(async () => ({ ok: true as const, data: [{ id: 1, name: 'Biología' }, { id: 2, name: 'Química' }] })) } })
    const onSelect = vi.fn()
    render(<Subjects selectedId={null} onSelect={onSelect} />)
    const list = await screen.findByRole('list', { name: 'Asignaturas' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    expect(onSelect).toHaveBeenCalledWith({ id: 2, name: 'Química' })
  })

  it('crea una asignatura, la lista y la selecciona', async () => {
    const api = installApi({ subjects: { create: vi.fn(async (name: string) => ({ ok: true as const, data: { id: 5, name } })) } })
    const onSelect = vi.fn()
    render(<Subjects selectedId={null} onSelect={onSelect} />)
    await screen.findByText(/Aún no hay asignaturas/)
    await userEvent.type(screen.getByLabelText('Nombre de la asignatura'), 'Biología')
    await userEvent.click(screen.getByRole('button', { name: 'Crear asignatura' }))
    expect(api.subjects.create).toHaveBeenCalledWith('Biología')
    expect(await screen.findByRole('button', { name: 'Biología' })).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith({ id: 5, name: 'Biología' })
    expect(screen.getByLabelText('Nombre de la asignatura')).toHaveValue('')
  })

  it('un error al crear se muestra en un alert y conserva el texto', async () => {
    installApi({ subjects: { create: vi.fn(async () => ({ ok: false as const, error: 'Ya existe una asignatura con ese nombre', code: 'INVALID' as const })) } })
    render(<Subjects selectedId={null} onSelect={vi.fn()} />)
    await userEvent.type(await screen.findByLabelText('Nombre de la asignatura'), 'Dup')
    await userEvent.click(screen.getByRole('button', { name: 'Crear asignatura' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una asignatura con ese nombre')
    expect(screen.getByLabelText('Nombre de la asignatura')).toHaveValue('Dup')
  })

  it('no permite enviar un nombre vacío', async () => {
    const api = installApi()
    render(<Subjects selectedId={null} onSelect={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Crear asignatura' })).toBeDisabled()
    expect(api.subjects.create).not.toHaveBeenCalled()
  })
})
