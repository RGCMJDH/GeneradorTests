import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from './App'
import { BridgeError, ErrorBoundary } from './components/ErrorBoundary'

export async function boot(rootEl: HTMLElement): Promise<Root> {
  const root = createRoot(rootEl)
  // Solo para previsualizar la interfaz en un navegador normal (sin Electron). En producción
  // `import.meta.env.DEV` es false y este bloque —con el mock— desaparece del paquete.
  if (import.meta.env.DEV && typeof window.api === 'undefined') {
    const { installDevMock } = await import('./devMock')
    installDevMock()
  }
  if (typeof window.api === 'undefined') {
    root.render(<BridgeError />)
    return root
  }
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
  return root
}
