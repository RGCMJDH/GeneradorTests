import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

async function boot(): Promise<void> {
  // Solo para previsualizar la interfaz en un navegador normal (sin Electron). En producción
  // `import.meta.env.DEV` es false y este bloque —con el mock— desaparece del paquete.
  if (import.meta.env.DEV && typeof window.api === 'undefined') {
    const { installDevMock } = await import('./devMock')
    installDevMock()
  }
  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void boot()
