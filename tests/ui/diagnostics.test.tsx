// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Diagnostics from '../../src/renderer/src/views/Diagnostics'
import { installApi } from './fakeApi'

const down = { ok: true as const, data: { ok: false, message: 'No se pudo conectar con Ollama en localhost:11434', model: 'qwen2.5:7b' } }
const up = { ok: true as const, data: { ok: true, message: 'Ollama listo', model: 'qwen2.5:7b' } }

describe('Diagnostics', () => {
  it('si Ollama no está disponible muestra el mensaje y los pasos', async () => {
    installApi({ system: { health: vi.fn(async () => down), config: vi.fn(async () => ({ ok: true as const, data: { model: 'llama3.1:8b' } })) } })
    const { container } = render(<Diagnostics />)
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent('No se pudo conectar con Ollama en localhost:11434')
    expect(banner).toHaveTextContent('https://ollama.com')
    expect(banner).toHaveTextContent('ollama pull llama3.1:8b')
    expect(container.querySelector('a')).toBeNull() // texto, no enlace que se abra solo
  })

  it('Reintentar vuelve a llamar a health y pasa a verde', async () => {
    const health = vi.fn().mockResolvedValueOnce(down).mockResolvedValue(up)
    installApi({ system: { health } })
    render(<Diagnostics />)
    await screen.findByRole('alert')
    expect(health).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(health).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/Ollama listo/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('se puede cerrar y queda un indicador para reabrirlo', async () => {
    installApi({ system: { health: vi.fn(async () => down) } })
    render(<Diagnostics />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Ollama no disponible/ }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('un fallo del propio IPC también se muestra', async () => {
    installApi({ system: { health: vi.fn(async () => ({ ok: false as const, error: 'Error interno', code: 'INTERNAL' as const })) } })
    render(<Diagnostics />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno')
  })

  it('si está bien, chip de estado', async () => {
    installApi()
    render(<Diagnostics />)
    expect(await screen.findByText(/Ollama listo/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
