import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal de confirmación. Se pinta en un portal bajo <body> y, mientras está abierto:
 * el resto de la página queda `inert`; Escape cancela (salvo ocupado) y Tab/Mayús+Tab dan la vuelta dentro del diálogo,
 * estés donde estés (los atajos van en `document`, no en el diálogo); el foco inicial es Cancelar y, al cerrar,
 * vuelve al elemento que lo abrió si sigue existiendo.
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancelar', danger, busy = false, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const descId = useId()
  const overlayRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const latest = useRef({ busy, onCancel })
  latest.current = { busy, onCancel }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overlay = overlayRef.current
    const inerted: { el: Element; had: boolean }[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === overlay || el.tagName === 'SCRIPT') continue
      inerted.push({ el, had: el.hasAttribute('inert') })
      el.setAttribute('inert', '')
    }
    cancelRef.current?.focus()

    const onKey = (e: KeyboardEvent): void => {
      const box = boxRef.current
      if (!box) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!latest.current.busy) latest.current.onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!first || !last) {
        e.preventDefault()
        box.focus()
      } else if (!box.contains(active) || active === box) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      for (const { el, had } of inerted) if (!had) el.removeAttribute('inert')
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  // Si el control con foco se deshabilita (operación en curso), el foco vuelve al propio diálogo.
  useEffect(() => {
    const box = boxRef.current
    const active = document.activeElement as HTMLButtonElement | null
    if (box && (!active || !box.contains(active) || active.disabled)) box.focus()
  }, [busy])

  return createPortal(
    <div ref={overlayRef} className="overlay">
      <div ref={boxRef} tabIndex={-1} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <h2 id={titleId}>{title}</h2>
        <div id={descId} className="dialog__body">
          {children}
        </div>
        <div className="row row--end">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'btn btn--danger' : 'btn btn--primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
