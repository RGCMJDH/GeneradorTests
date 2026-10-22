import type { Subject } from '../../../shared/api'

/** Props comunes de las pestañas de una asignatura. */
export interface TabProps {
  subject: Subject
}

/**
 * Trabajo sin terminar que se perdería al cambiar de asignatura:
 * importación en curso, revisión OCR abierta, generación de preguntas en curso ('generating') o intento de test en curso ('quiz').
 */
export type Blocking = 'import' | 'ocr' | 'generating' | 'quiz' | null
