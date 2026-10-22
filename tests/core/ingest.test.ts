import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '@core/store'
import { importTextFile, importPdf, NoTextError } from '@core/ingest'

const fixture = (name: string): string => join(__dirname, '..', 'fixtures', name)
const tmpFile = (name: string, content: string | Buffer): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'ingest-')), name)
  writeFileSync(p, content)
  return p
}

/** Sin listDocuments en el store: si no quedó documento, el siguiente id es el 1. */
const nextDocId = (store: Awaited<ReturnType<typeof openStore>>, subjectId: number): number =>
  store.addDocument({ subjectId, title: 'sonda', sourceType: 'text' }).id

describe('ingest', () => {
  it('importa markdown y crea chunks en la asignatura correcta', async () => {
    const store = await openStore()
    const a = store.createSubject('Biología')
    const b = store.createSubject('Historia')
    const res = await importTextFile({ store }, a.id, fixture('apuntes-ejemplo.md'))
    expect(res.document.subjectId).toBe(a.id)
    expect(res.document.sourceType).toBe('text')
    expect(res.document.title).toBe('apuntes-ejemplo')
    expect(res.chunks.length).toBeGreaterThan(0)
    expect(res.chunks.every((c) => c.subjectId === a.id && c.documentId === res.document.id)).toBe(true)
    expect(store.listChunks(a.id)).toHaveLength(res.chunks.length)
    expect(store.listChunks(b.id)).toEqual([])
    expect(res.warning).toBeUndefined()
  })

  it('quita BOM y normaliza CRLF', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const p = tmpFile('crlf.txt', '\uFEFFPrimer párrafo.\r\n\r\nSegundo párrafo.\r\n')
    const res = await importTextFile({ store }, s.id, p)
    const all = res.chunks.map((c) => c.text).join('\n')
    expect(all).not.toContain('\uFEFF')
    expect(all).not.toContain('\r')
    expect(all).toContain('Primer párrafo.')
  })

  it('importa PDF con texto', async () => {
    const store = await openStore()
    const s = store.createSubject('Biología')
    const res = await importPdf({ store }, s.id, fixture('apuntes.pdf'))
    expect(res.document.sourceType).toBe('pdf')
    expect(res.document.title).toBe('apuntes')
    expect(res.document.subjectId).toBe(s.id)
    expect(res.chunks.some((c) => c.text.includes('La mitocondria produce ATP mediante la fosforilación oxidativa.'))).toBe(true)
  })

  it('PDF sin texto lanza NoTextError y no deja documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const err = await importPdf({ store }, s.id, fixture('sin-texto.pdf')).catch((e) => e)
    expect(err).toBeInstanceOf(NoTextError)
    expect((err as Error).message).toMatch(/texto/i)
    expect(nextDocId(store, s.id)).toBe(1)
  })

  it('archivo vacío → documento sin chunks y aviso', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const p = tmpFile('vacio.md', '  \r\n \n')
    const res = await importTextFile({ store }, s.id, p)
    expect(res.document.title).toBe('vacio')
    expect(res.chunks).toEqual([])
    expect(store.listChunks(s.id)).toEqual([])
    expect(res.warning).toMatch(/vacío/i)
  })

  it('archivo inexistente → error legible y sin documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const missing = join(tmpdir(), 'no-existe-ingest-xyz.md')
    await expect(importTextFile({ store }, s.id, missing)).rejects.toThrow(/No se pudo leer/)
    await expect(importPdf({ store }, s.id, missing)).rejects.toThrow(/No se pudo leer/)
    expect(nextDocId(store, s.id)).toBe(1)
  })

  it('asignatura inexistente propaga el error del store', async () => {
    const store = await openStore()
    await expect(importTextFile({ store }, 999, fixture('apuntes-ejemplo.md'))).rejects.toThrow()
  })
})
