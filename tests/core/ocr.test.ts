import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '@core/store'
import { ocrImage } from '@core/ocr'
import { importImage, confirmOcr } from '@core/ingest'

const fixture = (name: string): string => join(__dirname, '..', 'fixtures', name)
// Caché de idiomas fuera de git (.cache/ está en .gitignore): solo se descarga la primera vez.
const ocrOpts = { cachePath: join(__dirname, '..', '..', '.cache', 'tessdata') }
const SLOW = 120_000

describe('ocr', () => {
  it('ocrImage lee una frase conocida del fixture (contiene "mitocondria")', async () => {
    const text = await ocrImage(fixture('foto-apuntes.png'), ocrOpts)
    expect(text.toLowerCase()).toContain('mitocondria')
  }, SLOW)

  it('ocrImage con un archivo inexistente lanza un error legible', async () => {
    const err = await ocrImage(join(tmpdir(), 'no-existe-xyz.png'), ocrOpts).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/no existe/i)
  })

  it('importImage devuelve ocrText y no crea chunks', async () => {
    const store = await openStore()
    const s = store.createSubject('Biología')
    const res = await importImage({ store }, s.id, fixture('foto-apuntes.png'), ocrOpts)
    expect(res.ocrText.toLowerCase()).toContain('mitocondria')
    expect(res.document.sourceType).toBe('image')
    expect(res.document.title).toBe('foto-apuntes')
    expect(res.document.subjectId).toBe(s.id)
    expect(res.document.path).toBe(fixture('foto-apuntes.png'))
    expect(store.listChunks(s.id)).toEqual([])
  }, SLOW)

  it('si el OCR falla (no es una imagen) no deja documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const p = join(mkdtempSync(join(tmpdir(), 'ocr-')), 'falso.png')
    writeFileSync(p, 'esto no es una imagen')
    const err = await importImage({ store }, s.id, p, ocrOpts).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/imagen/i)
    // Sin listDocuments: si no quedó documento, la siguiente fila es la 1.
    expect(store.addDocument({ subjectId: s.id, title: 'sonda', sourceType: 'text' }).id).toBe(1)
  }, SLOW)

  it('imagen corrupta con cabecera válida: error legible, sin excepción sin capturar ni documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const p = join(mkdtempSync(join(tmpdir(), 'ocr-')), 'corrupta.png')
    writeFileSync(p, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]))
    const err = await importImage({ store }, s.id, p, ocrOpts).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/corrupta\.png/)
    expect(store.addDocument({ subjectId: s.id, title: 'sonda', sourceType: 'text' }).id).toBe(1)
  }, SLOW)

  it('formato HEIC/HEIF: mensaje específico y sin documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const p = join(mkdtempSync(join(tmpdir(), 'ocr-')), 'foto.heic')
    writeFileSync(p, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(32)]))
    await expect(importImage({ store }, s.id, p, ocrOpts)).rejects.toThrow('Formato HEIC/HEIF no soportado: exporta la foto como JPG o PNG.')
    expect(store.addDocument({ subjectId: s.id, title: 'sonda', sourceType: 'text' }).id).toBe(1)
  })

  it('datos de idioma inalcanzables: rechaza con mensaje claro dentro del plazo, sin colgarse', async () => {
    const cachePath = mkdtempSync(join(tmpdir(), 'ocr-cache-')) // caché vacía: obliga a descargar
    const t0 = Date.now()
    const err = await ocrImage(fixture('foto-apuntes.png'), { langPath: 'http://127.0.0.1:9', cachePath, timeoutMs: 5000 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/No se pudieron cargar los datos de idioma del OCR/)
    expect(Date.now() - t0).toBeLessThan(15_000)
  }, 30_000)

  it('carga con plazo mínimo (timeoutMs 1): rechaza por tiempo agotado y cierra el worker tardío', async () => {
    const err = await ocrImage(fixture('foto-apuntes.png'), { ...ocrOpts, timeoutMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/datos de idioma del OCR.*tiempo de espera agotado/)
  }, SLOW)

  it('recognize con plazo mínimo: rechaza con «El OCR tardó demasiado» y la promesa se resuelve', async () => {
    const err = await ocrImage(fixture('foto-apuntes.png'), { ...ocrOpts, recognizeTimeoutMs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/El OCR tardó demasiado/)
  }, SLOW)

  it('importImage con archivo inexistente no deja documento', async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    await expect(importImage({ store }, s.id, join(tmpdir(), 'nada-xyz.png'), ocrOpts)).rejects.toThrow(/no existe/i)
    expect(store.addDocument({ subjectId: s.id, title: 'sonda', sourceType: 'text' }).id).toBe(1)
  })
})

describe('confirmOcr', () => {
  const setup = async () => {
    const store = await openStore()
    const s = store.createSubject('S')
    const doc = store.addDocument({ subjectId: s.id, title: 'foto', sourceType: 'image', path: 'foto.png' })
    return { store, s, doc }
  }

  it('crea chunks con el texto corregido', async () => {
    const { store, s, doc } = await setup()
    const chunks = confirmOcr({ store }, doc.id, 'La mitocondria produce energía.\n\nEl núcleo guarda el ADN.')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => c.documentId === doc.id && c.subjectId === s.id)).toBe(true)
    expect(chunks.map((c) => c.text).join('\n')).toContain('La mitocondria produce energía.')
    expect(store.listChunks(s.id, doc.id)).toEqual(chunks)
  })

  it('confirmar dos veces no duplica chunks', async () => {
    const { store, s, doc } = await setup()
    confirmOcr({ store }, doc.id, 'Texto viejo con errres.')
    const second = confirmOcr({ store }, doc.id, 'Texto nuevo corregido.')
    const stored = store.listChunks(s.id, doc.id)
    expect(stored).toEqual(second)
    expect(stored.map((c) => c.text).join('\n')).not.toContain('viejo')
    expect(stored[0].position).toBe(0)
  })

  it('texto corregido en blanco devuelve [] sin lanzar', async () => {
    const { store, s, doc } = await setup()
    expect(confirmOcr({ store }, doc.id, '  \n ')).toEqual([])
    expect(store.listChunks(s.id)).toEqual([])
  })

  it('documento que no es una imagen lanza error y no toca sus chunks', async () => {
    const { store, s } = await setup()
    const txt = store.addDocument({ subjectId: s.id, title: 'apuntes', sourceType: 'text' })
    store.addChunks(txt.id, s.id, ['original'])
    expect(() => confirmOcr({ store }, txt.id, 'otro texto')).toThrow(/no es una imagen/i)
    expect(store.listChunks(s.id, txt.id).map((c) => c.text)).toEqual(['original'])
  })

  it('documento desconocido lanza error en español', async () => {
    const { store } = await setup()
    expect(() => confirmOcr({ store }, 999, 'hola')).toThrow(/no existe/i)
  })
})
