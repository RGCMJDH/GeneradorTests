import type { ReactNode } from 'react'

/** Error visible para lectores de pantalla (role="alert"). No renderiza nada si no hay mensaje. */
export function Alert({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" className="alert">
      {children}
    </div>
  )
}

/** Mensaje de estado cortés (aria-live). El contenedor existe siempre para que los cambios se anuncien. */
export function Status({ children }: { children?: ReactNode }) {
  return (
    <p role="status" className="status" aria-live="polite">
      {children}
    </p>
  )
}

/** Indicador de trabajo en curso: texto + giratorio decorativo. */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="status status--busy" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  )
}
