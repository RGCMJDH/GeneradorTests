import type { Subject } from '../../../shared/api'

/** Props comunes de las pestañas de una asignatura. */
export interface TabProps {
  subject: Subject
}

/**
 * Trabajo sin terminar que se perdería al cambiar de asignatura:
 * importación en curso, revisión OCR abierta o test en curso (generando o respondiendo).
 */
export type Blocking = 'import' | 'ocr' | 'quiz' | null
