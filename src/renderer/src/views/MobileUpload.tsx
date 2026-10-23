import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { MobileSession } from '../../../shared/api'
import { Alert, Busy } from '../components/Alert'
import { UNEXPECTED_ERROR } from '../errors'

/** El QR lo genera main como PNG `data:`. Cualquier otra cosa (URL remota, SVG, script) no se pinta nunca. */
const QR_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

const EXPIRED_NOTICE = 'La subida desde el móvil se desactivó solo a los 10 minutos. Puedes iniciarla de nuevo.'

export interface ReceivedPhoto {
  documentId: number
  text: string
}

interface Props {
  subjectId: number
  /** Foto del móvil ya reconocida (OCR) para ESTA asignatura: el padre abre la misma revisión que una foto importada en el PC. */
  onPhoto(photo: ReceivedPhoto): void
  /** Avisa de que hay (o ya no hay) una sesión abierta: cambiar de asignatura la detendría. */
  onActiveChange(active: boolean): void
}

const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Sección «Fotos desde el móvil»: servidor local temporal + QR. Todo el texto recibido se muestra como texto plano. */
export default function MobileUpload({ subjectId, onPhoto, onActiveChange }: Props) {
  const [session, setSession] = useState<MobileSession | null>(null)
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [focusNext, setFocusNext] = useState<'heading' | 'start' | null>(null)
  const sessionRef = useRef<MobileSession | null>(null)
  const mounted = useRef(true)
  const latest = useRef({ onPhoto, onActiveChange })
  latest.current = { onPhoto, onActiveChange }
  const headingRef = useRef<HTMLHeadingElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  const endSession = useCallback((message: string): void => {
    sessionRef.current = null
    setSession(null)
    setNotice(message)
    latest.current.onActiveChange(false)
  }, [])

  // Al desmontar (p. ej. al cambiar de asignatura) la sesión se detiene: no queda un puerto abierto sin interfaz.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (sessionRef.current) void window.api.mobile.stop()
    }
  }, [])

  useEffect(() => {
    const offImage = window.api.mobile.onImage((e) => {
      if (e.subjectId !== subjectId) return // foto de otra asignatura (sesión anterior): se ignora
      if ('error' in e) return setError(`La foto recibida del móvil no se pudo procesar. ${e.error}`)
      setNotice('Foto recibida del móvil: revisa el texto reconocido antes de trocearlo.')
      latest.current.onPhoto({ documentId: e.documentId, text: e.ocrText })
    })
    const offStopped = window.api.mobile.onStopped(() => endSession(EXPIRED_NOTICE))
    return () => {
      offImage()
      offStopped()
    }
  }, [subjectId, endSession])

  // Cuenta atrás. Main es quien apaga el servidor (y avisa); esto es solo la red de seguridad si ese aviso no llegara.
  useEffect(() => {
    if (!session) return
    const tick = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= session.expiresAt) {
        endSession(EXPIRED_NOTICE)
        void window.api.mobile.stop().catch(() => undefined)
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [session, endSession])

  useEffect(() => {
    if (focusNext === 'heading' && session) headingRef.current?.focus()
    else if (focusNext === 'start' && !session) startRef.current?.focus()
    else return
    setFocusNext(null)
  }, [focusNext, session])

  async function startSession(): Promise<void> {
    setBusy('start')
    setError(null)
    setNotice('')
    try {
      const res = await window.api.mobile.start({ subjectId })
      if (!mounted.current) {
        if (res.ok) void window.api.mobile.stop() // la vista se cerró mientras arrancaba: no dejar el puerto abierto
        return
      }
      if (!res.ok) return setError(res.error)
      if (!QR_PNG.test(res.data.qrDataUrl)) {
        void window.api.mobile.stop()
        return setError('No se pudo mostrar el código QR, así que la subida desde el móvil se ha detenido. Inténtalo de nuevo.')
      }
      sessionRef.current = res.data
      setSession(res.data)
      setNow(Date.now())
      latest.current.onActiveChange(true)
      setFocusNext('heading')
    } catch {
      if (mounted.current) setError(UNEXPECTED_ERROR)
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  async function stopSession(): Promise<void> {
    setBusy('stop')
    setError(null)
    try {
      const res = await window.api.mobile.stop()
      if (!res.ok) return setError(res.error)
      endSession('Subida desde el móvil detenida.')
      setFocusNext('start')
    } catch {
      setError(UNEXPECTED_ERROR)
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId}>Fotos desde el móvil</h3>
      {session ? (
        <div className="card mobile">
          <h4 ref={headingRef} tabIndex={-1}>
            Escanea el código con el móvil
          </h4>
          <p>Tu móvil y este ordenador deben estar en la misma wifi. Escanea el código y haz una foto del apunte.</p>
          <img className="mobile__qr" src={session.qrDataUrl} alt="Código QR para subir fotos desde el móvil" width={224} height={224} />
          <p>
            Si no puedes escanear, escribe esta dirección en el navegador del móvil: <code className="mobile__url">{session.url}</code>
          </p>
          <p role="note" className="notice">
            Cualquiera en tu red con este enlace podría enviar fotos mientras esté activo. Se desactiva solo a los 10 minutos o al pulsar Detener.
          </p>
          <p className="muted">Si el móvil no conecta, permite a la app en el Firewall de Windows (redes privadas).</p>
          <p role="timer" aria-live="off">
            <strong>Activo</strong> · se desactiva solo en {clock(session.expiresAt - now)}
          </p>
          <div className="row">
            <button type="button" className="btn btn--danger" disabled={busy !== null} onClick={() => void stopSession()}>
              Detener
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button ref={startRef} type="button" className="btn btn--primary" disabled={busy !== null} onClick={() => void startSession()}>
            Subir desde el móvil
          </button>
        </div>
      )}
      {busy === 'start' ? <Busy>Abriendo la subida desde el móvil…</Busy> : <p className="status" aria-live="polite">{notice}</p>}
      <Alert>{error}</Alert>
    </section>
  )
}
