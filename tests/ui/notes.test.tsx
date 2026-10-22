// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Notes from '../../src/renderer/src/views/Notes'
import { ChunkFocusProvider, useChunkFocus } from '../../src/renderer/src/chunkFocus'
import { doc, installApi } from './fakeApi'

const subject = { id: 7, name: 'Biología' }
const okDocs = (docs = [doc()]) => vi.fn(async () => ({ ok: true as const, data: docs }))
const chunk = (id: number, text: string, documentId = 1) => ({ id, documentId, subjectId: 7, position: id, text })

function Trigger({ id, label }: { id: number; label: string }) {
  const { focusChunk } = useChunkFocus()
  return <button onClick={() => focusChunk(id)}>{label}</button>
}

describe('Notes', () => {
  it('lista los documentos con título, tipo y nº de fragmentos', async () => {
    installApi({ notes: { list: okDocs([doc(), doc({ id: 2, title: 'Foto pizarra', sourceType: 'image', chunkCount: 1 })]) } })
    render(<Notes subject={subject} />)
    const list = await screen.findByRole('list', { name: 'Documentos' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Apuntes de célula')
    expect(items[0]).toHaveTextContent('Texto')
    expect(items[0]).toHaveTextContent('3 fragmentos')
    expect(items[1]).toHaveTextContent('Foto')
    expect(items[1]).toHaveTextContent('1 fragmento')
  })

  it('importa un archivo de texto y recarga la lista', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValue({ ok: true, data: [doc()] })
    const api = installApi({
      notes: {
        list,
        import: vi.fn(async () => ({ ok: true as const, data: { canceled: false as const, kind: 'text' as const, document: doc() } }))
      }
    })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar texto/ }))
    expect(api.notes.import).toHaveBeenCalledWith(7, 'text')
    expect(await screen.findByRole('status')).toHaveTextContent(/Apuntes de célula.*3 fragmentos/)
    expect(await screen.findByRole('list', { name: 'Documentos' })).toBeInTheDocument()
  })

  it('cancelar el diálogo no muestra error', async () => {
    installApi()
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar PDF/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('PDF sin texto: explica con honestidad que el OCR es solo para imágenes', async () => {
    installApi({ notes: { import: vi.fn(async () => ({ ok: false as const, error: 'El PDF no tiene texto', code: 'NO_TEXT' as const })) } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar PDF/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no contiene texto/i)
    expect(alert).toHaveTextContent(/solo.*imágenes/i)
    expect(alert).toHaveTextContent(/exporta/i)
    // No se ofrece ningún botón de "pasar por OCR" que no funcionaría.
    expect(screen.queryByRole('button', { name: /OCR/i })).not.toBeInTheDocument()
  })

  it('un Result con ok:false muestra el error en role=alert', async () => {
    installApi({ notes: { list: vi.fn(async () => ({ ok: false as const, error: 'La base de datos está bloqueada', code: 'INTERNAL' as const })) } })
    render(<Notes subject={subject} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('La base de datos está bloqueada')
  })

  it('eliminar pide confirmación y solo entonces borra', async () => {
    const api = installApi({ notes: { list: okDocs() } })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar Apuntes de célula' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Apuntes de célula')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(api.notes.deleteDocument).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Apuntes de célula' }))
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }))
    expect(api.notes.deleteDocument).toHaveBeenCalledWith(7, 1)
  })

  it('el texto de un fragmento se muestra como texto plano (sin crear elementos)', async () => {
    const evil = '<img src=x onerror=alert(1)> y <script>alert(2)</script>'
    installApi({ notes: { list: okDocs(), chunks: vi.fn(async () => ({ ok: true as const, data: [chunk(11, evil)] })) } })
    const { container } = render(<Notes subject={subject} />)
    const frag = await screen.findByText(evil)
    expect(frag).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('los fragmentos tienen ancla chunk-<id>', async () => {
    installApi({ notes: { list: okDocs(), chunks: vi.fn(async () => ({ ok: true as const, data: [chunk(11, 'uno'), chunk(12, 'dos')] })) } })
    const { container } = render(<Notes subject={subject} />)
    await screen.findByText('dos')
    expect(container.querySelector('#chunk-11')).not.toBeNull()
    expect(container.querySelector('#chunk-12')).not.toBeNull()
  })

  it('focusChunk (para QuoteLink) hace scroll y resalta el fragmento', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    installApi({ notes: { list: okDocs(), chunks: vi.fn(async () => ({ ok: true as const, data: [chunk(11, 'uno'), chunk(12, 'dos')] })) } })
    const { container } = render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Trigger id={12} label="ver fragmento" />
        <Notes subject={subject} />
      </ChunkFocusProvider>
    )
    await screen.findByText('dos')
    await userEvent.click(screen.getByRole('button', { name: 'ver fragmento' }))
    await waitFor(() => expect(container.querySelector('#chunk-12')).toHaveClass('chunk--focused'))
    expect(scroll).toHaveBeenCalled()
    expect(container.querySelector('#chunk-11')).not.toHaveClass('chunk--focused')
  })

  it('focusChunk de un fragmento de otro documento carga ese documento', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const chunksFn = vi.fn(async (_s: number, d?: number) => ({
      ok: true as const,
      data: d === 2 ? [chunk(21, 'otro doc', 2)] : [chunk(11, 'uno', 1)]
    }))
    installApi({
      notes: {
        list: okDocs([doc(), doc({ id: 2, title: 'Segundo' })]),
        chunks: chunksFn,
        chunk: vi.fn(async () => ({ ok: true as const, data: { id: 21, documentId: 2, documentTitle: 'Segundo', position: 0, text: 'otro doc' } }))
      }
    })
    const { container } = render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Trigger id={21} label="ir" />
        <Notes subject={subject} />
      </ChunkFocusProvider>
    )
    await screen.findByText('uno')
    await userEvent.click(screen.getByRole('button', { name: 'Ver fragmentos de Apuntes de célula' }))
    await userEvent.click(screen.getByRole('button', { name: 'ir' }))
    await waitFor(() => expect(container.querySelector('#chunk-21')).toHaveClass('chunk--focused'))
  })

  it('tras importar una foto abre la revisión OCR con el texto editable', async () => {
    installApi({
      notes: { import: vi.fn(async () => ({ ok: true as const, data: { canceled: false as const, kind: 'image' as const, documentId: 9, ocrText: 'La celula es la unidad' } })) }
    })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar foto/ }))
    expect(await screen.findByLabelText(/Texto reconocido/)).toHaveValue('La celula es la unidad')
    expect(screen.getByRole('button', { name: 'Confirmar y trocear' })).toBeInTheDocument()
  })

  it('deshabilita los botones de importación mientras trabaja', async () => {
    let release: (v: unknown) => void = () => {}
    installApi({
      notes: {
        import: vi.fn(
          () =>
            new Promise((r) => {
              release = r
            })
        ) as never
      }
    })
    render(<Notes subject={subject} />)
    await userEvent.click(await screen.findByRole('button', { name: /Importar foto/ }))
    expect(screen.getByRole('button', { name: /Importar PDF/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/OCR|Leyendo/)
    release({ ok: true, data: { canceled: true } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Importar PDF/ })).toBeEnabled())
  })
})
