// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/src/App'
import Notes from '../../src/renderer/src/views/Notes'
import { ChunkFocusProvider, useChunkFocus } from '../../src/renderer/src/chunkFocus'
import { doc, importResult, installApi } from './fakeApi'

const subject = { id: 7, name: 'Biología' }
const twoSubjects = vi.fn(async () => ({ ok: true as const, data: [{ id: 7, name: 'Biología' }, { id: 8, name: 'Química' }] }))
const imageImport = importResult({ file: 'foto.png', ok: true, kind: 'image', documentId: 9, ocrText: 'Texto OCR' })
const chunk = (id: number, text: string, documentId = 1) => ({ id, documentId, subjectId: 7, position: id, text })

describe('I1: cambiar de asignatura con trabajo sin terminar', () => {
  it('con una revisión OCR abierta pide confirmación; cancelar mantiene asignatura y revisión', async () => {
    installApi({ subjects: { list: twoSubjects }, notes: { importMany: imageImport } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: /Importar foto/ }))
    await screen.findByLabelText(/Texto reconocido/)
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/revisión de OCR sin confirmar/)
    expect(dialog).toHaveTextContent(/se perderá/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Biología', level: 2 })).toBeInTheDocument()
    expect(screen.getByLabelText(/Texto reconocido/)).toHaveValue('Texto OCR')
    // confirmando sí cambia
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Cambiar y perder/ }))
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Texto reconocido/)).not.toBeInTheDocument()
  })

  it('con una importación en curso también pide confirmación', async () => {
    installApi({ subjects: { list: twoSubjects }, notes: { importMany: vi.fn(() => new Promise(() => {})) as never } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: /Importar PDF/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/importación en curso/)
  })

  it('sin trabajo pendiente cambia directamente, y pulsar la asignatura actual no hace nada', async () => {
    installApi({ subjects: { list: twoSubjects } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(screen.getByRole('button', { name: 'Biología' }))
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
  })

  it('un documento foto sin trocear ofrece "Reanudar revisión" con textarea vacío y aviso', async () => {
    const api = installApi({
      notes: {
        list: vi.fn(async () => ({ ok: true as const, data: [doc({ id: 9, title: 'Foto pizarra', sourceType: 'image', chunkCount: 0 }), doc({ id: 1 })] })),
        confirmOcr: vi.fn(async () => ({ ok: true as const, data: { documentId: 9, chunkCount: 1, deletedQuestions: 0 } }))
      }
    })
    render(<Notes subject={subject} />)
    expect(screen.queryByRole('button', { name: /Reanudar revisión de Apuntes de célula/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Reanudar revisión de Foto pizarra' }))
    const box = screen.getByLabelText(/Texto reconocido/)
    expect(box).toHaveValue('')
    expect(screen.getAllByRole('note').map((n) => n.textContent).join(' ')).toMatch(/El texto OCR original no se guardó; pega o escribe el texto de la foto/)
    // S2: el documento en revisión no se puede eliminar ni reanudar otra vez
    expect(screen.getByRole('button', { name: 'Eliminar Foto pizarra' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reanudar revisión de Foto pizarra' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Eliminar Apuntes de célula' })).toBeEnabled()
    await userEvent.type(box, 'La célula')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(api.notes.confirmOcr).toHaveBeenCalledWith(9, 'La célula')
  })
})

describe('I3: el foco no se pierde', () => {
  it('cancelar un borrado devuelve el foco al botón Eliminar', async () => {
    installApi({ notes: { list: vi.fn(async () => ({ ok: true as const, data: [doc()] })) } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Apuntes de célula' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('button', { name: 'Eliminar Apuntes de célula' })).toHaveFocus()
  })

  it('tras confirmar un borrado el foco va al encabezado Documentos', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: true, data: [doc()] }).mockResolvedValue({ ok: true, data: [] })
    installApi({ notes: { list } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Apuntes de célula' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('tras confirmar la revisión OCR el foco va al encabezado Documentos', async () => {
    installApi({ notes: { importMany: imageImport } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar foto/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar y trocear' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus())
  })

  it('tras descartar la foto el foco va al encabezado Documentos', async () => {
    installApi({ notes: { importMany: imageImport } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar foto/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar foto' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Documentos' })).toHaveFocus())
  })
})

describe('S4: focusChunk con fragmento no disponible', () => {
  function Triggers() {
    const { focusChunk } = useChunkFocus()
    return (
      <>
        <button onClick={() => focusChunk(12)}>ir12</button>
        <button onClick={() => focusChunk(99)}>ir99</button>
      </>
    )
  }
  const setup = (chunkFn: () => Promise<unknown>) => {
    Element.prototype.scrollIntoView = vi.fn()
    installApi({
      notes: {
        list: vi.fn(async () => ({ ok: true as const, data: [doc()] })),
        chunks: vi.fn(async () => ({ ok: true as const, data: [chunk(11, 'uno'), chunk(12, 'dos')] })),
        chunk: chunkFn as never
      }
    })
    return render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Triggers />
        <Notes subject={subject} />
      </ChunkFocusProvider>
    )
  }

  it('si el fragmento no existe avisa y quita el resaltado anterior', async () => {
    const { container } = setup(async () => ({ ok: false, error: 'Fragmento no encontrado', code: 'NOT_FOUND' }))
    await screen.findByText('dos')
    await userEvent.click(screen.getByRole('button', { name: 'ir12' }))
    await waitFor(() => expect(container.querySelector('#chunk-12')).toHaveClass('chunk--focused'))
    await userEvent.click(screen.getByRole('button', { name: 'ir99' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fragmento no encontrado')
    expect(container.querySelector('.chunk--focused')).toBeNull()
  })

  it('si existe pero no aparece en la lista de su documento, no se queda pendiente', async () => {
    const { container } = setup(async () => ({ ok: true, data: { id: 99, documentId: 1, documentTitle: 'x', position: 0, text: 'x' } }))
    await screen.findByText('dos')
    await userEvent.click(screen.getByRole('button', { name: 'ir99' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está disponible/)
    expect(container.querySelector('.chunk--focused')).toBeNull()
  })
})

describe('S5: paneles de pestaña', () => {
  it('un panel sin contenido enfocable recibe tabindex=0; uno con botones no', async () => {
    installApi({ subjects: { list: twoSubjects } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    expect(document.getElementById('panel-history')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tabpanel', { name: 'Apuntes' })).not.toHaveAttribute('tabindex')
  })
})
