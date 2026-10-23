import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDevMockApi } from '../../src/renderer/src/devMock'
import type { MobileImageEvent } from '../../src/shared/api'

afterEach(() => vi.useRealTimers())

describe('devMock: subida desde el móvil', () => {
  it('start devuelve URL + QR PNG de relleno + expiresAt, y simula la llegada de una foto', async () => {
    vi.useFakeTimers()
    const api = createDevMockApi()
    const photos: MobileImageEvent[] = []
    api.mobile.onImage((e) => photos.push(e))
    const p = api.mobile.start({ subjectId: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    const res = await p
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(res.data.url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/u\//)
    expect(res.data.expiresAt).toBeGreaterThan(Date.now())
    expect(photos).toEqual([])
    await vi.advanceTimersByTimeAsync(9000)
    expect(photos).toHaveLength(1)
    const ev = photos[0]!
    expect(ev.subjectId).toBe(1)
    if ('error' in ev) throw new Error('inesperado')
    const docs = await api.notes.list(1)
    expect(docs.ok && docs.data.some((d) => d.id === ev.documentId && d.sourceType === 'image' && d.chunkCount === 0)).toBe(true)
    expect(ev.ocrText.length).toBeGreaterThan(10)
  })

  it('stop cancela la simulación', async () => {
    vi.useFakeTimers()
    const api = createDevMockApi()
    const photos: unknown[] = []
    api.mobile.onImage((e) => photos.push(e))
    const p = api.mobile.start({ subjectId: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(await api.mobile.stop()).toEqual({ ok: true, data: null })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(photos).toEqual([])
  })

  it('a los 10 minutos avisa con onStopped', async () => {
    vi.useFakeTimers()
    const api = createDevMockApi()
    const stopped = vi.fn()
    api.mobile.onStopped(stopped)
    const p = api.mobile.start({ subjectId: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await p
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(stopped).toHaveBeenCalledWith({ reason: 'expired' })
  })

  it('la suscripción devuelve la función para cancelarla', async () => {
    vi.useFakeTimers()
    const api = createDevMockApi()
    const cb = vi.fn()
    const off = api.mobile.onImage(cb)
    off()
    const p = api.mobile.start({ subjectId: 1 })
    await vi.advanceTimersByTimeAsync(20_000)
    await p
    expect(cb).not.toHaveBeenCalled()
  })
})
