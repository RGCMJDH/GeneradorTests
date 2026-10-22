// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Concepts from '../../src/renderer/src/views/Concepts'
import Notes from '../../src/renderer/src/views/Notes'
import { ChunkFocusProvider } from '../../src/renderer/src/chunkFocus'
import type { Concept, ConceptsOutcome } from '../../src/shared/api'
import { doc, installApi } from './fakeApi'

const ADN: Concept = { term: 'ADN', chunkIds: [11], related: [] }
const okC = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
const outcome = (concepts: Concept[], over: Partial<ConceptsOutcome> = {}): ConceptsOutcome => ({ concepts, cancelled: false, analyzed: 3, total: 3, failed: 0, ...over })
const docs = [doc({ id: 1, title: 'Tema 1' }), doc({ id: 2, title: 'Tema 2' }), doc({ id: 3, title: 'Foto', chunkCount: 0, sourceType: 'image' })]

function renderConcepts(props: Partial<React.ComponentProps<typeof Concepts>> = {}) {
  return render(
    <ChunkFocusProvider onReveal={() => {}}>
      <Concepts subjectId={7} docs={docs} {...props} />
    </ChunkFocusProvider>
  )
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Conceptos: fallos del modelo', () => {
  it('si fallaron fragmentos, el resultado lo dice con el número', async () => {
    installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN], { analyzed: 5, total: 5, failed: 2 }))) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByText(/2 fragmentos no se pudieron analizar/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Conceptos' })).toBeInTheDocument()
  })

  it('con un solo fallo usa el singular y sin fallos no menciona nada', async () => {
    const build = vi.fn().mockResolvedValueOnce({ ok: true, data: outcome([ADN], { failed: 1 }) }).mockResolvedValue({ ok: true, data: outcome([ADN]) })
    installApi({ concepts: { build } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByText(/1 fragmento no se pudo analizar/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    await waitFor(() => expect(screen.queryByText(/no se pudo analizar/)).not.toBeInTheDocument())
  })

  it('si el modelo no respondió (todos fallidos) muestra el alert y conserva el índice anterior', async () => {
    installApi({
      concepts: {
        list: vi.fn(() => okC([ADN])),
        build: vi.fn(async () => ({
          ok: false as const,
          error: 'No se pudieron extraer conceptos: el modelo no respondió. Comprueba que Ollama está en marcha.',
          code: 'MODEL_UNAVAILABLE' as const
        }))
      }
    })
    renderConcepts()
    await screen.findByRole('button', { name: /^ADN/ })
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/el modelo no respondió/)
    expect(screen.getByRole('button', { name: /^ADN/ })).toBeInTheDocument()
    expect(screen.queryByText(/0 conceptos extraídos/)).not.toBeInTheDocument()
  })
})

describe('Conceptos: selector de documento', () => {
  const selector = () => screen.getByRole('combobox', { name: /Documento/ })

  it('por defecto «Todos los documentos» y ofrece cada documento con fragmentos', async () => {
    installApi()
    renderConcepts()
    const sel = await screen.findByRole('combobox', { name: /Documento/ })
    expect(sel).toHaveValue('')
    const labels = [...sel.querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toEqual(['Todos los documentos', 'Tema 1', 'Tema 2']) // la foto sin trocear no se ofrece
  })

  it('sin documentId cuando son todos, y con el documentId elegido cuando se elige uno', async () => {
    const api = installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN]))) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    const first = (api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(first).not.toHaveProperty('documentId')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toBeEnabled())
    await userEvent.selectOptions(selector(), 'Tema 2')
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    expect((api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({ subjectId: 7, documentId: 2 })
  })

  it('muestra el índice completo devuelto (mezclado), no solo lo de ese documento', async () => {
    const merged = [ADN, { term: 'ribosomas', chunkIds: [21], related: [] }]
    installApi({ concepts: { list: vi.fn(() => okC(merged)), build: vi.fn(() => okC(outcome(merged, { analyzed: 1, total: 1 }))) } })
    renderConcepts()
    await screen.findByRole('button', { name: /^ribosomas/ })
    await userEvent.selectOptions(selector(), 'Tema 1')
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    await screen.findByText(/2 conceptos extraídos/)
    expect(screen.getByRole('button', { name: /^ribosomas/ })).toBeInTheDocument()
  })

  it('está deshabilitado mientras se extrae', async () => {
    const d = deferred<never>()
    installApi({ concepts: { build: vi.fn(() => d.promise as never) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(selector()).toBeDisabled()
  })

  it('si el documento elegido desaparece de la lista vuelve a «Todos»', async () => {
    const api = installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN]))) } })
    const { rerender } = renderConcepts()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Documento/ }), 'Tema 2')
    rerender(
      <ChunkFocusProvider onReveal={() => {}}>
        <Concepts subjectId={7} docs={[docs[0]]} />
      </ChunkFocusProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Extraer conceptos' }))
    expect((api.concepts.build as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('documentId')
  })

  it('si no se analizó todo, solo sugiere extraer por documento cuando hay más de uno', async () => {
    installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN], { analyzed: 60, total: 90 }))) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByText(/Se analizaron 60 de 90 fragmentos; para el resto extrae los conceptos de un documento concreto/)).toBeInTheDocument()
  })

  it('con un solo documento no sugiere algo que no ayudaría', async () => {
    installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN], { analyzed: 60, total: 90 }))) } })
    renderConcepts({ docs: [docs[0]] })
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    expect(await screen.findByText(/Se analizaron 60 de 90 fragmentos/)).toBeInTheDocument()
    expect(screen.queryByText(/documento concreto/)).not.toBeInTheDocument()
  })

  it('en Apuntes el selector lista los documentos de la asignatura', async () => {
    installApi({ notes: { list: vi.fn(() => okC([doc({ id: 1, title: 'Tema 1' }), doc({ id: 2, title: 'Tema 2' })])) } })
    render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Notes subject={{ id: 7, name: 'Biología' }} />
      </ChunkFocusProvider>
    )
    const sel = await screen.findByRole('combobox', { name: /Documento/ })
    await waitFor(() => expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Todos los documentos', 'Tema 1', 'Tema 2']))
  })
})

describe('Conceptos: foco', () => {
  it('al terminar la extracción el foco vuelve al botón «Extraer conceptos»', async () => {
    installApi({ concepts: { build: vi.fn(() => okC(outcome([ADN]))) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toHaveFocus())
  })

  it('al cancelar (desaparece «Cancelar») el foco también vuelve al botón', async () => {
    const d = deferred<{ ok: true; data: ConceptsOutcome }>()
    installApi({ concepts: { build: vi.fn(() => d.promise as never) } })
    renderConcepts()
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    d.resolve({ ok: true, data: outcome([], { cancelled: true }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extraer conceptos' })).toHaveFocus())
  })

  it('no roba el foco si el usuario lo movió a otro control durante la extracción', async () => {
    const d = deferred<{ ok: true; data: ConceptsOutcome }>()
    installApi({ concepts: { build: vi.fn(() => d.promise as never) } })
    render(
      <ChunkFocusProvider onReveal={() => {}}>
        <Concepts subjectId={7} docs={docs} />
        <input aria-label="otro" />
      </ChunkFocusProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Extraer conceptos' }))
    await userEvent.click(screen.getByLabelText('otro'))
    d.resolve({ ok: true, data: outcome([ADN]) })
    await screen.findByRole('list', { name: 'Conceptos' })
    expect(screen.getByLabelText('otro')).toHaveFocus()
  })
})
