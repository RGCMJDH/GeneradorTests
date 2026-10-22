import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  content: ReactNode
}

interface Props {
  label: string
  tabs: TabDef[]
  active: string
  onChange(id: string): void
}

/**
 * Pestañas accesibles (patrón WAI-ARIA, activación automática): flechas, Inicio/Fin, tabindex itinerante.
 * Todos los paneles quedan montados (los inactivos con `hidden`) para no perder el estado de cada vista.
 */
export function Tabs({ label, tabs, active, onChange }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = tabs.findIndex((t) => t.id === active)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const target = tabs[next] as TabDef
    onChange(target.id)
    refs.current[target.id]?.focus()
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            className="tabs__tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} className="tabs__panel">
          {t.content}
        </div>
      ))}
    </div>
  )
}
