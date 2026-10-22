import { useCallback, useEffect, useRef, useState } from 'react'

type Health = { status: 'checking' } | { status: 'ok'; message: string } | { status: 'down'; message: string }

/**
 * Estado de Ollama. No bloquea la app: importar apuntes funciona sin IA.
 * Caído → aviso destacado (cerrable, queda un indicador para reabrirlo); bien → chip verde.
 */
export default function Diagnostics() {
  const [health, setHealth] = useState<Health>({ status: 'checking' })
  const [model, setModel] = useState('')
  const [dismissed, setDismissed] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const alive = useRef(true)

  const check = useCallback(async (): Promise<void> => {
    let h, c
    try {
      ;[h, c] = await Promise.all([window.api.system.health(), window.api.system.config()])
    } catch {
      if (alive.current) setHealth({ status: 'down', message: 'No se pudo comprobar el estado de Ollama.' })
      return
    }
    if (!alive.current) return
    if (c.ok) setModel(c.data.model)
    else if (h.ok) setModel(h.data.model)
    if (!h.ok) setHealth({ status: 'down', message: h.error })
    else setHealth({ status: h.data.ok ? 'ok' : 'down', message: h.data.message })
  }, [])

  useEffect(() => {
    alive.current = true
    void check()
    return () => {
      alive.current = false
    }
  }, [check])

  async function retry(): Promise<void> {
    setRetrying(true)
    try {
      await check()
    } finally {
      if (alive.current) setRetrying(false)
    }
  }

  if (health.status === 'checking') return <p className="chip chip--idle">Comprobando Ollama…</p>
  if (health.status === 'ok') {
    return (
      <p className="chip chip--ok" role="status">
        <span aria-hidden="true">●</span> {health.message}
        {model && ` · ${model}`}
      </p>
    )
  }
  if (dismissed) {
    return (
      <button type="button" className="chip chip--down" onClick={() => setDismissed(false)}>
        <span aria-hidden="true">●</span> Ollama no disponible · ver detalles
      </button>
    )
  }
  return (
    <section role="alert" className="banner" aria-labelledby="diag-title">
      <h2 id="diag-title">Ollama no está disponible</h2>
      <p>{health.message}</p>
      <p>
        Puedes importar y leer tus apuntes igualmente; para generar tests hace falta la IA local. Para activarla:
      </p>
      <ol>
        <li>
          Instala Ollama desde <code>https://ollama.com</code> (copia la dirección en tu navegador) y ábrelo.
        </li>
        <li>
          Descarga el modelo ejecutando en una terminal: <code>ollama pull {model || '<modelo>'}</code>
        </li>
        <li>Pulsa «Reintentar».</li>
      </ol>
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => void retry()} disabled={retrying}>
          {retrying ? 'Comprobando…' : 'Reintentar'}
        </button>
        <button type="button" className="btn" onClick={() => setDismissed(true)}>
          Cerrar
        </button>
      </div>
    </section>
  )
}
