// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../../src/renderer/src/components/ConfirmDialog'

function Host({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      <button>otro botón</button>
      {open && (
        <ConfirmDialog title="Título" confirmLabel="Aceptar" onConfirm={onConfirm} onCancel={() => setOpen(false)}>
          <p>Cuerpo</p>
        </ConfirmDialog>
      )}
    </>
  )
}

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'abrir' }))
  return screen.getByRole('alertdialog')
}

describe('ConfirmDialog', () => {
  it('el foco inicial está en Cancelar', async () => {
    render(<Host />)
    await open()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })

  it('Escape cierra y devuelve el foco a quien lo abrió', async () => {
    render(<Host />)
    await open()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'abrir' })).toHaveFocus()
  })

  it('Tab da la vuelta hacia delante y Mayús+Tab hacia atrás', async () => {
    render(<Host />)
    await open()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus()
  })

  it('tras pulsar el fondo, Escape sigue cerrando', async () => {
    render(<Host />)
    await open()
    await userEvent.click(document.querySelector('.overlay') as HTMLElement)
    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('tras pulsar el fondo, Tab devuelve el foco al diálogo', async () => {
    render(<Host />)
    await open()
    await userEvent.click(document.querySelector('.overlay') as HTMLElement)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await userEvent.click(document.querySelector('.overlay') as HTMLElement)
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus()
  })

  it('el resto de la página queda inert mientras está abierto', async () => {
    const { container } = render(<Host />)
    expect(container).not.toHaveAttribute('inert')
    await open()
    expect(container).toHaveAttribute('inert')
    expect(screen.getByRole('alertdialog').closest('.overlay')).not.toHaveAttribute('inert')
    await userEvent.keyboard('{Escape}')
    expect(container).not.toHaveAttribute('inert')
  })

  it('ocupado: Escape no cierra y, si el control con foco se deshabilita, el foco pasa al diálogo', async () => {
    const onCancel = vi.fn()
    const props = { title: 'T', confirmLabel: 'Aceptar', onConfirm: () => {}, onCancel }
    const { rerender } = render(<ConfirmDialog {...props}>x</ConfirmDialog>)
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    rerender(
      <ConfirmDialog {...props} busy>
        x
      </ConfirmDialog>
    )
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('alertdialog')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    await userEvent.tab() // sin controles habilitados el foco no se escapa
    expect(screen.getByRole('alertdialog')).toHaveFocus()
  })
})
