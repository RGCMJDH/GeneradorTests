// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MobileImageEvent, MobileStoppedEvent } from '../../src/shared/api'
import App from '../../src/renderer/src/App'
import Notes from '../../src/renderer/src/views/Notes'
import { installApi, MOBILE_URL, QR_PNG } from './fakeApi'

const subject = { id: 7, name: 'Biología' }
const START = 'Subir desde el móvil'

/** Bus de eventos main → renderer: guarda los suscriptores y permite emitir. */
function bus() {
  const img = new Set<(e: MobileImageEvent) => void>()
  const stopped = new Set<(e: MobileStoppedEvent) => void>()
  return {
    over: {
      onImage: vi.fn((cb: (e: MobileImageEvent) => void) => {
        img.add(cb)
        return () => void img.delete(cb)
      }),
      onStopped: vi.fn((cb: (e: MobileStoppedEvent) => void) => {
        stopped.add(cb)
        return () => void stopped.delete(cb)
      })
    },
    image: (e: MobileImageEvent) => act(() => img.forEach((cb) => cb(e))),
    stopped: (e: MobileStoppedEvent) => act(() => stopped.forEach((cb) => cb(e))),
    subscribers: () => img.size + stopped.size
  }
}

const photo = (documentId: number, ocrText: string, subjectId = 7): MobileImageEvent => ({ subjectId, documentId, ocrText })
const start = () => userEvent.click(screen.getByRole('button', { name: START }))

afterEach(() => {
  vi.useRealTimers()
})

describe('MobileUpload: sesión', () => {
  it('antes de empezar solo hay el botón; no hay QR ni servidor', () => {
    const api = installApi()
    render(<Notes subject={subject} />)
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
    expect(screen.queryByRole('img', { name: /Código QR/ })).not.toBeInTheDocument()
    expect(api.mobile.start).not.toHaveBeenCalled()
  })

  it('start muestra QR, URL como texto, instrucciones, aviso de seguridad y pista del cortafuegos', async () => {
    const api = installApi()
    render(<Notes subject={subject} />)
    await start()
    expect(api.mobile.start).toHaveBeenCalledWith({ subjectId: 7 })
    const qr = await screen.findByRole('img', { name: 'Código QR para subir fotos desde el móvil' })
    expect(qr).toHaveAttribute('src', QR_PNG)
    expect(screen.getByText(MOBILE_URL)).toBeInTheDocument()
    expect(screen.getByText('Tu móvil y este ordenador deben estar en la misma wifi. Escanea el código y haz una foto del apunte.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Cualquiera en tu red con este enlace podría enviar fotos mientras esté activo. Se desactiva solo a los 10 minutos o al pulsar Detener. La foto viaja sin cifrar por tu wifi; usa solo redes de confianza.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Si el móvil no conecta, permite a la app en el Firewall de Windows \(redes privadas\)/)).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/Activo/)
    expect(screen.getByRole('timer')).toHaveTextContent(/10:00|9:5\d/)
    expect(screen.getByRole('button', { name: 'Detener' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: START })).not.toBeInTheDocument()
  })

  it('el foco pasa al encabezado de la sesión al arrancar y vuelve al botón al detener', async () => {
    installApi()
    render(<Notes subject={subject} />)
    await start()
    const heading = await screen.findByRole('heading', { name: /Escanea el código/ })
    expect(heading).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Detener' }))
    await waitFor(() => expect(screen.getByRole('button', { name: START })).toHaveFocus())
  })

  it('Detener llama a mobile.stop y vuelve al estado inicial', async () => {
    const api = installApi()
    render(<Notes subject={subject} />)
    await start()
    await userEvent.click(await screen.findByRole('button', { name: 'Detener' }))
    expect(api.mobile.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img', { name: /Código QR/ })).not.toBeInTheDocument()
    expect(screen.queryByText(MOBILE_URL)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
  })

  it('si Detener falla muestra el error y mantiene la sesión visible (puede reintentarse)', async () => {
    installApi({ mobile: { stop: vi.fn(async () => ({ ok: false as const, error: 'No se pudo parar', code: 'INTERNAL' as const })) } })
    render(<Notes subject={subject} />)
    await start()
    await userEvent.click(await screen.findByRole('button', { name: 'Detener' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo parar')
    expect(screen.getByRole('button', { name: 'Detener' })).toBeEnabled()
  })

  it('un error al arrancar (sin wifi) se muestra en un Alert y se puede reintentar', async () => {
    const startFn = vi.fn().mockResolvedValueOnce({ ok: false, error: 'No se encontró una red local (wifi)', code: 'INTERNAL' })
    const api = installApi({ mobile: { start: startFn } })
    render(<Notes subject={subject} />)
    await start()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró una red local (wifi)')
    expect(screen.queryByRole('img', { name: /Código QR/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
    expect(api.mobile.stop).not.toHaveBeenCalled()
  })

  it('la URL se pinta como texto plano (nada de HTML ni enlaces)', async () => {
    const evil = 'http://192.168.1.40:5555/u/x"><img src=x onerror=alert(1)><a href="javascript:alert(2)">'
    installApi({ mobile: { start: vi.fn(async () => ({ ok: true as const, data: { url: evil, qrDataUrl: QR_PNG, expiresAt: Date.now() + 600_000 } })) } })
    const { container } = render(<Notes subject={subject} />)
    await start()
    expect(await screen.findByText(evil)).toBeInTheDocument()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1) // solo el QR
    expect(screen.queryByRole('link', { name: /192\.168/ })).not.toBeInTheDocument()
  })

  it('un qrDataUrl que no sea un PNG data: no se pinta; se detiene la sesión y se avisa', async () => {
    for (const bad of ['http://evil.example/qr.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const api = installApi({ mobile: { start: vi.fn(async () => ({ ok: true as const, data: { url: MOBILE_URL, qrDataUrl: bad, expiresAt: Date.now() + 600_000 } })) } })
      const { container, unmount } = render(<Notes subject={subject} />)
      await start()
      expect(await screen.findByRole('alert')).toHaveTextContent(/código QR/)
      expect(container.querySelector('img')).toBeNull()
      expect(api.mobile.stop).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('cuenta atrás: muestra el tiempo restante y se actualiza cada segundo', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    installApi({ mobile: { start: vi.fn(async () => ({ ok: true as const, data: { url: MOBILE_URL, qrDataUrl: QR_PNG, expiresAt: Date.now() + 65_000 } })) } })
    render(<Notes subject={subject} />)
    await start()
    expect(await screen.findByRole('timer')).toHaveTextContent('1:05')
    act(() => void vi.advanceTimersByTime(5_000))
    expect(screen.getByRole('timer')).toHaveTextContent('1:00')
  })

  it('si la cuenta atrás llega a cero sin aviso de main, vuelve al estado inicial con un aviso y asegura el stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const api = installApi({ mobile: { start: vi.fn(async () => ({ ok: true as const, data: { url: MOBILE_URL, qrDataUrl: QR_PNG, expiresAt: Date.now() + 2_000 } })) } })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    act(() => void vi.advanceTimersByTime(3_000))
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.getByText(/se desactivó/i)).toBeInTheDocument()
    expect(api.mobile.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
  })

  it('mobile:stopped (caducó en main) apaga la interfaz y lo explica', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.stopped({ reason: 'expired' })
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Código QR/ })).not.toBeInTheDocument()
    expect(screen.getByText(/se desactivó solo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: START })).toBeEnabled()
  })
})

describe('MobileUpload: fotos recibidas', () => {
  it('una foto de la asignatura actual abre la MISMA revisión OCR (texto editable, sin trocear aún)', async () => {
    const b = bus()
    const api = installApi({
      mobile: b.over,
      notes: { confirmOcr: vi.fn(async () => ({ ok: true as const, data: { documentId: 9, chunkCount: 2, deletedQuestions: 0 } })) }
    })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    const listCalls = vi.mocked(api.notes.list).mock.calls.length
    b.image(photo(9, 'La celula es la unidad'))
    const box = await screen.findByLabelText(/Texto reconocido/)
    expect(box).toHaveValue('La celula es la unidad')
    expect(screen.getByRole('heading', { name: 'Revisa el texto reconocido' })).toBeInTheDocument()
    expect(api.notes.confirmOcr).not.toHaveBeenCalled() // nada se trocea sin que el usuario confirme
    await waitFor(() => expect(vi.mocked(api.notes.list).mock.calls.length).toBeGreaterThan(listCalls))
    await userEvent.clear(box)
    await userEvent.type(box, 'La célula es la unidad básica')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar y trocear' }))
    expect(api.notes.confirmOcr).toHaveBeenCalledWith(9, 'La célula es la unidad básica')
    expect(await screen.findByText(/Texto confirmado: 2 fragmentos/)).toBeInTheDocument()
  })

  it('una foto de OTRA asignatura se ignora: no se abre ninguna revisión ni se muestra nada', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.image(photo(12, 'texto ajeno', 8))
    b.image({ subjectId: 8, error: 'fallo ajeno' })
    expect(screen.queryByLabelText(/Texto reconocido/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/ajeno/)).not.toBeInTheDocument()
  })

  it('una foto de otra asignatura no se descarta en silencio: avisa de que quedó «Sin trocear» en esa asignatura', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.image(photo(12, 'texto ajeno', 8))
    expect(screen.getByText('Llegó una foto para otra asignatura; quedó guardada como «Sin trocear» en esa asignatura.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Texto reconocido/)).not.toBeInTheDocument()
    expect(screen.queryByText(/texto ajeno/)).not.toBeInTheDocument()
  })

  it('si la foto de otra asignatura falló al procesarse, el aviso lo dice sin mostrar el detalle', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.image({ subjectId: 8, error: 'fallo ajeno' })
    expect(screen.getByText('Llegó una foto para otra asignatura y no se pudo procesar.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un error al procesar la foto se muestra en un Alert (texto plano)', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.image({ subjectId: 7, error: 'No se pudo reconocer el texto de «<b>x</b>»' })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo reconocer el texto de «<b>x</b>»')
    expect(alert.querySelector('b')).toBeNull()
    expect(screen.queryByLabelText(/Texto reconocido/)).not.toBeInTheDocument()
  })

  it('con una revisión ya abierta, la foto nueva espera en cola (con aviso) y se abre al terminar la primera', async () => {
    const b = bus()
    const api = installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    b.image(photo(9, 'primera'))
    expect(await screen.findByLabelText(/Texto reconocido/)).toHaveValue('primera')
    b.image(photo(10, 'segunda'))
    expect(screen.getByLabelText(/Texto reconocido/)).toHaveValue('primera')
    expect(screen.getByText(/1 foto más esperando revisión/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Descartar foto' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar' }))
    expect(api.notes.deleteDocument).toHaveBeenCalledWith(7, 9)
    await waitFor(() => expect(screen.getByLabelText(/Texto reconocido/)).toHaveValue('segunda'))
    expect(screen.queryByText(/esperando revisión/)).not.toBeInTheDocument()
  })

  it('una foto recibida tras pulsar Detener (OCR terminando) sigue abriendo su revisión', async () => {
    const b = bus()
    installApi({ mobile: b.over })
    render(<Notes subject={subject} />)
    await start()
    await userEvent.click(await screen.findByRole('button', { name: 'Detener' }))
    b.image(photo(9, 'tardía'))
    expect(await screen.findByLabelText(/Texto reconocido/)).toHaveValue('tardía')
  })
})

describe('MobileUpload: ciclo de vida y bloqueo', () => {
  it('desmontar sin haber iniciado sesión no llama a stop', () => {
    const api = installApi()
    render(<Notes subject={subject} />).unmount()
    expect(api.mobile.stop).not.toHaveBeenCalled()
  })

  it('desmontar Notes con la sesión activa llama a mobile.stop y cancela las suscripciones', async () => {
    const b = bus()
    const api = installApi({ mobile: b.over })
    const { unmount } = render(<Notes subject={subject} />)
    await start()
    await screen.findByRole('timer')
    expect(b.subscribers()).toBe(2)
    unmount()
    expect(api.mobile.stop).toHaveBeenCalledTimes(1)
    expect(b.subscribers()).toBe(0)
  })

  it('si start termina cuando la vista ya se desmontó, se detiene el servidor recién abierto', async () => {
    let release: (v: unknown) => void = () => {}
    const api = installApi({ mobile: { start: vi.fn(() => new Promise((r) => (release = r))) as never } })
    const { unmount } = render(<Notes subject={subject} />)
    await start()
    unmount()
    release({ ok: true, data: { url: MOBILE_URL, qrDataUrl: QR_PNG, expiresAt: Date.now() + 600_000 } })
    await waitFor(() => expect(api.mobile.stop).toHaveBeenCalledTimes(1))
  })

  it("onBlockingChange: 'mobile' mientras está activa; la revisión OCR tiene prioridad; null al detener", async () => {
    const b = bus()
    installApi({ mobile: b.over })
    const onBlockingChange = vi.fn()
    render(<Notes subject={subject} onBlockingChange={onBlockingChange} />)
    expect(onBlockingChange).toHaveBeenLastCalledWith(null)
    await start()
    await screen.findByRole('timer')
    expect(onBlockingChange).toHaveBeenLastCalledWith('mobile')
    b.image(photo(9, 'x'))
    await screen.findByLabelText(/Texto reconocido/)
    expect(onBlockingChange).toHaveBeenLastCalledWith('ocr')
    await userEvent.click(screen.getByRole('button', { name: 'Descartar foto' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith('mobile'))
    await userEvent.click(screen.getByRole('button', { name: 'Detener' }))
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith(null))
  })
})

describe('MobileUpload: cambiar de asignatura', () => {
  const two = vi.fn(async () => ({ ok: true as const, data: [{ id: 7, name: 'Biología' }, { id: 8, name: 'Química' }] }))

  it('con la sesión activa pide confirmación; cancelar la mantiene y confirmar la detiene', async () => {
    const api = installApi({ subjects: { list: two } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: START }))
    await screen.findByRole('timer')

    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/subida desde el móvil/i)
    expect(dialog).toHaveTextContent(/se detendrá/i)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('heading', { name: 'Biología', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toBeInTheDocument()
    expect(api.mobile.stop).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Cambiar y perder/ }))
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
    expect(api.mobile.stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
  })

  it('tras detener la sesión, cambiar de asignatura ya no pregunta', async () => {
    installApi({ subjects: { list: two } })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: START }))
    await userEvent.click(await screen.findByRole('button', { name: 'Detener' }))
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Química', level: 2 })).toBeInTheDocument()
  })

  it('una foto que llega tras cambiar de asignatura no abre nada en la nueva', async () => {
    const b = bus()
    installApi({ subjects: { list: two }, mobile: b.over })
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Biología' }))
    await userEvent.click(await screen.findByRole('button', { name: START }))
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Química' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /Cambiar y perder/ }))
    b.image(photo(9, 'de Biología', 7))
    expect(screen.queryByLabelText(/Texto reconocido/)).not.toBeInTheDocument()
  })
})
