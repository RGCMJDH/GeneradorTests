import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onReload?: () => void
}

/** Evita la pantalla en blanco si un componente lanza al renderizar. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error de interfaz', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="fatal">
        <h1>Algo ha fallado en la interfaz</h1>
        <p>Tus apuntes están guardados. Recarga la ventana para volver a empezar.</p>
        <button type="button" className="btn btn--primary" onClick={this.props.onReload ?? (() => window.location.reload())}>
          Recargar
        </button>
      </div>
    )
  }
}

/** Pantalla cuando el preload no expuso `window.api` (la app no puede funcionar sin él). */
export function BridgeError() {
  return (
    <div role="alert" className="fatal">
      <h1>No se pudo cargar el puente de la aplicación</h1>
      <p>La interfaz no puede comunicarse con el programa. Reinicia la aplicación: ciérrala y vuelve a abrirla. Si el problema continúa, vuelve a instalarla.</p>
    </div>
  )
}
