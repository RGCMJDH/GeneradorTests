import QuizPanel from './QuizPanel'
import type { Blocking, TabProps } from './types'

interface Props extends TabProps {
  /** La pestaña está visible (el formulario recarga los documentos al mostrarse). */
  active?: boolean
  /** Avisa de que hay una generación o un intento en curso que se perdería al cambiar de asignatura. */
  onBlockingChange?(blocking: Blocking): void
  onShowHistory?(): void
}

/** Pestaña Test: preguntas de verdadero/falso, test y desarrollo. */
export default function TestTab(props: Props) {
  return <QuizPanel {...props} mode="test" />
}
