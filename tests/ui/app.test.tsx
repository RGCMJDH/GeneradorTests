// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/src/App'
import { installApi } from './fakeApi'

const subjects = vi.fn(async () => ({ ok: true as const, data: [{ id: 7, name: 'Biología' }] }))

describe('App', () => {
  it('sin asignatura seleccionada invita a elegir o crear una', async () => {
    installApi({ subjects: { list: subjects } })
    render(<App />)
    expect(await screen.findByText(/Elige o crea una asignatura/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('al elegir una asignatura aparecen las pestañas y Apuntes es la inicial', async () => {
    installApi({ subjects: { list: subjects } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Apuntes', 'Test', 'Ejercicios', 'Historial'])
    expect(screen.getByRole('tab', { name: 'Apuntes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Apuntes' })).toBeVisible()
  })

  it('navega las pestañas con el teclado y la de Ejercicios sigue siendo un marcador de posición', async () => {
    installApi({ subjects: { list: subjects } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    screen.getByRole('tab', { name: 'Apuntes' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Test' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Test' })).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'Test' })).toHaveTextContent('Tipo de pregunta')
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tabpanel', { name: 'Ejercicios' })).toHaveTextContent('Disponible en la siguiente fase')
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}') // da la vuelta
    expect(screen.getByRole('tab', { name: 'Apuntes' })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Historial' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Apuntes' })).toHaveFocus()
    // roving tabindex: solo la pestaña activa está en el orden de tabulación
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toHaveLength(1)
  })

  it('importar apuntes sigue funcionando con Ollama caído', async () => {
    const api = installApi({
      subjects: { list: subjects },
      system: { health: vi.fn(async () => ({ ok: true as const, data: { ok: false, message: 'Ollama no responde', model: 'qwen2.5:7b' } })) }
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Ollama no responde')
    await userEvent.click(screen.getByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: /Importar texto/ }))
    expect(api.notes.import).toHaveBeenCalledWith(7, 'text')
  })
})
