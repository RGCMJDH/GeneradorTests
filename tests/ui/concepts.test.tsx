// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../src/renderer/src/App'
import Concepts from '../../src/renderer/src/views/Concepts'
import Notes from '../../src/renderer/src/views/Notes'
import { GenerateForm } from '../../src/renderer/src/components/GenerateForm'
import { ChunkFocusProvider, useChunkFocus } from '../../src/renderer/src/chunkFocus'
import type { Concept, ConceptsOutcome, ProgressEvent } from '../../src/shared/api'
import { doc, installApi } from './fakeApi'

const ADN: Concept = { term: 'ADN', chunkIds: [11, 12], related: ['núcleo celular', 'ARN'] }
const RIBO: Concept = { term: 'ribosomas', chunkIds: [13], related: [] }
const okC = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
const outcome = (concepts: Concept[], over: Partial<ConceptsOutcome> = {}): ConceptsOutcome => ({ concepts, cancelled: false, analyzed: 3, total: 3, failed: 0, ...over })

function Probe() {
  const { request } = useChunkFocus()
  return <p data-testid="focus">{request ? `chunk ${request.chunkId}` : 'ninguno'}</p>
}

function renderConcepts(props: Partial<React.ComponentProps<typeof Concepts>> = {}) {
  return render(
    <ChunkFocusProvider onReveal={() => {}}>
      <Concepts subjectId={7} {...props} />
      <Probe />
    </ChunkFocusProvider>
  )
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Conceptos', () => {
  it('carga el índice guardado de la asignatura y lo lista con su nº de fragmentos', async () => {
    const api = installApi({ concepts: { list: vi.fn(() => okC([ADN, RIBO])) } })
    renderConcepts()
    const list = await screen.findByRole('list', { name: 'Conceptos' })
    expect(api.concepts.list).toHaveBeenCalledWith(7)
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('ADN')
    expect(items[0]).toHaveTextContent('2 fragmentos')
    expect(items[1]).toHaveTextContent('ribosomas')
    expect(items[1]).toHaveTextContent('1 fragmento')
  })

  it('sin conceptos lo dice y avisa de que extraer puede tardar minutos en CPU', async () => {
    installApi()
    renderConcepts()
    expect(await screen.findByText(/Todavía no has extraído conceptos/)).toBeInTheDocument()
    expect(screen.getByText(/varios minutos/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Conceptos' })).not.toBeInTheDocument()
  })

  it('«Extraer conceptos» lanza la extracción, muestra el estado de trabajo y lista el resultado', async () => {
    const d = deferred<{ ok: true; data: ConceptsOutcome }>()
    const api = installApi({ concepts: { build: vi.fn(() => d.promise as never) } })
    const onBusyChange = vi.fn()
    renderConcepts({ onBusyChange })
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(api.concepts.build).toHaveBeenCalledTimes(1)
    const req = (api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0] as { requestId: string; subjectId: number }
    expect(req.subjectId).toBe(7)
    expect(req.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent(/Extrayendo conceptos/)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    d.resolve(await okC(outcome([ADN, RIBO])))
    expect(await screen.findByRole('list', { name: 'Conceptos' })).toBeInTheDocument()
    expect(await screen.findByText(/2 conceptos extraídos de 3 fragmentos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeEnabled()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('muestra el progreso del requestId propio e ignora el de otros', async () => {
    let push: (e: ProgressEvent) => void = () => {}
    const d = deferred<never>()
    const api = installApi({
      concepts: {
        onProgress: vi.fn((cb: (e: ProgressEvent) => void) => {
          push = cb
          return () => {}
        }),
        build: vi.fn(() => d.promise as never)
      }
    })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    const id = (api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0].requestId as string
    push({ requestId: 'otro', done: 9, total: 9 })
    push({ requestId: id, done: 2, total: 5 })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('fragmento 2 de 5'))
  })

  it('si se analizaron menos fragmentos de los que hay, lo avisa', async () => {
    installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN], { analyzed: 60, total: 75 }))) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByText(/60 de 75 fragmentos/)).toBeInTheDocument()
  })

  it('pulsar un concepto muestra sus relacionados como texto y enlaces «Ver fragmento» que usan el foco de fragmentos', async () => {
    installApi({ concepts: { list: vi.fn(() => okC([ADN, RIBO])) } })
    renderConcepts()
    const adn = await screen.findByRole('button', { name: /^ADN/ })
    expect(adn).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(adn)
    expect(adn).toHaveAttribute('aria-pressed', 'true')
    const detail = screen.getByRole('region', { name: 'Detalle de ADN' })
    expect(detail).toHaveTextContent('Relacionados: núcleo celular, ARN')
    await userEvent.click(within(detail).getByRole('button', { name: 'Ver fragmento 2' }))
    expect(screen.getByTestId('focus')).toHaveTextContent('chunk 12')
    // otro concepto sin relacionados
    await userEvent.click(screen.getByRole('button', { name: /^ribosomas/ }))
    expect(screen.getByRole('region', { name: 'Detalle de ribosomas' })).toHaveTextContent('Sin términos relacionados')
    expect(screen.queryByRole('region', { name: 'Detalle de ADN' })).not.toBeInTheDocument()
    // volver a pulsar cierra
    await userEvent.click(screen.getByRole('button', { name: /^ribosomas/ }))
    expect(screen.queryByRole('region', { name: /Detalle/ })).not.toBeInTheDocument()
  })

  it('Cancelar pide cancelar con el mismo requestId, conserva el índice anterior y lo explica', async () => {
    const d = deferred<{ ok: true; data: ConceptsOutcome }>()
    const api = installApi({
      concepts: { list: vi.fn(() => okC([RIBO])), build: vi.fn(() => d.promise as never) }
    })
    renderConcepts()
    await screen.findByRole('list', { name: 'Conceptos' })
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    const id = (api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0].requestId as string
    expect(api.concepts.cancel).toHaveBeenCalledWith(id)
    d.resolve(await okC(outcome([ADN], { cancelled: true, analyzed: 1 })))
    expect(await screen.findByText(/Extracción cancelada/)).toBeInTheDocument()
    expect(screen.getByText(/no se guardó/i)).toBeInTheDocument()
    // sigue mostrando el índice guardado, no el parcial
    expect(screen.getByRole('button', { name: /^ribosomas/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ADN/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeEnabled()
  })

  it('un error de la extracción se muestra en role=alert y libera los botones', async () => {
    installApi({ concepts: { build: vi.fn(async () => ({ ok: false as const, error: 'No se pudo conectar con Ollama', code: 'INTERNAL' as const })) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con Ollama')
    expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
  })

  it('una excepción inesperada también da un alert genérico', async () => {
    installApi({ concepts: { build: vi.fn(async () => { throw new Error('boom') }) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeEnabled()
  })

  it('un fallo al cargar el índice guardado se muestra', async () => {
    installApi({ concepts: { list: vi.fn(async () => ({ ok: false as const, error: 'Base de datos bloqueada', code: 'INTERNAL' as const })) } })
    renderConcepts()
    expect(await screen.findByRole('alert')).toHaveTextContent('Base de datos bloqueada')
  })

  it('un término con marcado se pinta como texto (sin crear elementos)', async () => {
    const evil: Concept = { term: '<img src=x onerror=alert(1)>', chunkIds: [1], related: ['<script>alert(2)</script>'] }
    installApi({ concepts: { list: vi.fn(() => okC([evil])) } })
    const { container } = renderConcepts()
    const btn = await screen.findByRole('button', { name: /<img src=x onerror=alert\(1\)>/ })
    await userEvent.click(btn)
    expect(screen.getByRole('region', { name: /^Detalle de/ })).toHaveTextContent('<script>alert(2)</script>')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('al desmontar con una extracción en curso la cancela', async () => {
    const d = deferred<never>()
    const api = installApi({ concepts: { build: vi.fn(() => d.promise as never) } })
    const { unmount } = renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    const id = (api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0].requestId as string
    unmount()
    expect(api.concepts.cancel).toHaveBeenCalledWith(id)
  })

  it('en Apuntes aparece la sección y la extracción bloquea el cambio de asignatura', async () => {
    const d = deferred<never>()
    installApi({
      notes: { list: vi.fn(() => okC([doc()])) },
      concepts: { build: vi.fn(() => d.promise as never) }
    })
    const onBlockingChange = vi.fn()
    render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Notes subject={{ id: 7, name: 'Biología' }} onBlockingChange={onBlockingChange} />
      </ChunkFocusProvider>
    )
    expect(await screen.findByRole('heading', { name: 'Conceptos' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith('concepts'))
  })
})

describe('Conceptos y cambio de asignatura', () => {
  it('con una extracción en curso, cambiar de asignatura pide confirmación explicando qué se pierde', async () => {
    installApi({
      subjects: { list: vi.fn(() => okC([{ id: 7, name: 'Biología' }, { id: 8, name: 'Química' }])) },
      concepts: { build: vi.fn(() => new Promise(() => {})) as never }
    })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/extracción de conceptos en curso/)
    expect(dialog).toHaveTextContent(/se cancelará/)
  })
})

describe('GenerateForm con conceptos', () => {
  const formProps = { subjectId: 7, active: true, onGenerate: () => {} }
  const options = (c: HTMLElement) => [...c.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))

  it('ofrece los conceptos extraídos como sugerencias del tema', async () => {
    const api = installApi({ concepts: { list: vi.fn(() => okC([ADN, RIBO])) } })
    const { container } = render(<GenerateForm {...formProps} />)
    await waitFor(() => expect(options(container)).toEqual(['ADN', 'ribosomas']))
    expect(api.concepts.list).toHaveBeenCalledWith(7)
    const input = screen.getByLabelText(/Tema/)
    expect(input).toHaveAttribute('list')
    expect(container.querySelector('datalist')?.id).toBe(input.getAttribute('list'))
  })

  it('elegir una sugerencia la envía como tema', async () => {
    installApi({ concepts: { list: vi.fn(() => okC([ADN])) }, notes: { list: vi.fn(() => okC([doc()])) } })
    const onGenerate = vi.fn()
    const { container } = render(<GenerateForm {...formProps} onGenerate={onGenerate} />)
    await waitFor(() => expect(options(container)).toEqual(['ADN']))
    await userEvent.type(screen.getByLabelText(/Tema/), 'ADN')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ topic: 'ADN' }))
  })

  it('sigue aceptando texto libre aunque haya conceptos', async () => {
    installApi({ concepts: { list: vi.fn(() => okC([ADN])) }, notes: { list: vi.fn(() => okC([doc()])) } })
    const onGenerate = vi.fn()
    const { container } = render(<GenerateForm {...formProps} onGenerate={onGenerate} />)
    await waitFor(() => expect(options(container)).toEqual(['ADN']))
    await userEvent.type(screen.getByLabelText(/Tema/), '  la membrana  ')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ topic: 'la membrana' }))
  })

  it('sin conceptos (o si falla la carga) se comporta como antes: sin sugerencias y texto libre', async () => {
    installApi({ concepts: { list: vi.fn(async () => ({ ok: false as const, error: 'x', code: 'INTERNAL' as const })) }, notes: { list: vi.fn(() => okC([doc()])) } })
    const onGenerate = vi.fn()
    const { container } = render(<GenerateForm {...formProps} onGenerate={onGenerate} />)
    await screen.findByRole('option', { name: 'Apuntes de célula' })
    expect(options(container)).toEqual([])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // las sugerencias son opcionales: sin ruido
    await userEvent.type(screen.getByLabelText(/Tema/), 'ohm')
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }))
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ topic: 'ohm' }))
  })

  it('los términos con marcado se ofrecen como valor de texto, sin crear elementos', async () => {
    installApi({ concepts: { list: vi.fn(() => okC([{ term: '<b>x</b>', chunkIds: [1], related: [] }])) } })
    const { container } = render(<GenerateForm {...formProps} />)
    await waitFor(() => expect(options(container)).toEqual(['<b>x</b>']))
    expect(container.querySelector('b')).toBeNull()
  })

  it('recarga las sugerencias al volver a mostrarse la pestaña (active)', async () => {
    const list = vi.fn().mockResolvedValueOnce({ ok: true, data: [] }).mockResolvedValue({ ok: true, data: [ADN] })
    installApi({ concepts: { list } })
    const { container, rerender } = render(<GenerateForm {...formProps} active={false} />)
    expect(list).not.toHaveBeenCalled()
    rerender(<GenerateForm {...formProps} active />)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    rerender(<GenerateForm {...formProps} active={false} />)
    rerender(<GenerateForm {...formProps} active />)
    await waitFor(() => expect(options(container)).toEqual(['ADN']))
  })
})
