import type { Subject } from '../../../shared/api'

/** Props comunes de las pestañas de una asignatura. */
export interface TabProps {
  subject: Subject
}

/**
 * Trabajo sin terminar que se perdería al cambiar de asignatura:
 * importación en curso, revisión OCR abierta, extracción de conceptos en curso ('concepts'), generación de preguntas en curso ('generating'), intento de test en curso ('quiz') o subida desde el móvil activa ('mobile').
 */
export type Blocking = 'import' | 'ocr' | 'concepts' | 'mobile' | 'generating' | 'quiz' | null
