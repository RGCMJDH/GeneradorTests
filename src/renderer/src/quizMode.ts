/** Modo de la pantalla de cuestionario: preguntas de test o ejercicios prácticos. Misma mecánica, distinto vocabulario. */
export type QuizMode = 'test' | 'exercises'

/** Igual en test y ejercicios: el problema es el modelo, no los apuntes. */
export const MODEL_UNAVAILABLE =
  'No se pudo contactar con el modelo de IA, así que no se ha generado nada. Comprueba que Ollama esté en marcha y tenga el modelo descargado (aviso «Ollama no disponible») y vuelve a intentarlo.'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export interface ModeText {
  countLabel: string
  countError(min: number, max: number): string
  noNotes: string
  intro: string | null
  progressTitle: string
  /** «0 de 5 preguntas» */
  progressUnit: string
  generated(count: number): string
  kept(count: number): string
  noneYet: string
  insufficient: string
  nothingGenerated: string
  discarded(n: number): string
  hidden(n: number): string
  start: string
  another: string
  preparing: string
  scoreTitle: string
  repeat: string
  unanswered(n: number): string
  itemTitle: string
  skip: string
  endLabel: string
  endGroup: string
  endExplain: string
}

const TEST: ModeText = {
  countLabel: 'Número de preguntas',
  countError: (min, max) => `El número de preguntas debe ser un entero entre ${min} y ${max}.`,
  noNotes: 'Esta asignatura aún no tiene apuntes con texto. Importa apuntes en la pestaña Apuntes antes de generar un test.',
  intro: null,
  progressTitle: 'Generando preguntas',
  progressUnit: 'preguntas',
  generated: (n) => (n === 1 ? 'Se generó 1 pregunta con cita de tus apuntes.' : `Se generaron ${n} preguntas, cada una con su cita de tus apuntes.`),
  kept: (n) => `Se conservaron ${plural(n, 'pregunta ya generada', 'preguntas ya generadas')}.`,
  noneYet: 'Todavía no se había generado ninguna pregunta.',
  insufficient: 'No hay material suficiente en tus apuntes para ese tema',
  nothingGenerated: 'No se generó ninguna pregunta. Prueba otra vez o cambia el tema.',
  discarded: (n) =>
    n === 1 ? 'Se descartó 1 pregunta que no se pudo respaldar con tus apuntes.' : `Se descartaron ${n} preguntas que no se pudieron respaldar con tus apuntes.`,
  hidden: (n) => (n === 1 ? 'pregunta sin cita no se muestra' : 'preguntas sin cita no se muestran'),
  start: 'Empezar el test',
  another: 'Generar otras',
  preparing: 'Preparando el test…',
  scoreTitle: 'Test terminado',
  repeat: 'Repetir con otras preguntas',
  unanswered: (n) => (n === 1 ? '1 pregunta sin responder' : `${n} preguntas sin responder`),
  itemTitle: 'Pregunta',
  skip: 'Saltar esta pregunta',
  endLabel: 'Terminar el test aquí',
  endGroup: 'Confirmar el final del test',
  endExplain: 'Se terminará el test y solo contarán las preguntas respondidas hasta ahora.'
}

const EXERCISES: ModeText = {
  countLabel: 'Número de ejercicios',
  countError: (min, max) => `El número de ejercicios debe ser un entero entre ${min} y ${max}.`,
  noNotes: 'Esta asignatura aún no tiene apuntes con texto. Importa apuntes en la pestaña Apuntes antes de generar ejercicios.',
  intro: 'Los ejercicios se generan solo a partir de tus apuntes: hace falta que incluyan datos o ejemplos resueltos.',
  progressTitle: 'Generando ejercicios',
  progressUnit: 'ejercicios',
  generated: (n) => (n === 1 ? 'Se generó 1 ejercicio con cita de tus apuntes.' : `Se generaron ${n} ejercicios, cada uno con su cita de tus apuntes.`),
  kept: (n) => `Se conservaron ${plural(n, 'ejercicio ya generado', 'ejercicios ya generados')}.`,
  noneYet: 'Todavía no se había generado ningún ejercicio.',
  insufficient: 'No hay ejercicios prácticos en tus apuntes para ese tema (hace falta que incluyan datos o ejemplos resueltos)',
  nothingGenerated: 'No se generó ningún ejercicio. Prueba otra vez o cambia el tema.',
  discarded: (n) =>
    n === 1 ? 'Se descartó 1 ejercicio que no se pudo respaldar con tus apuntes.' : `Se descartaron ${n} ejercicios que no se pudieron respaldar con tus apuntes.`,
  hidden: (n) => (n === 1 ? 'ejercicio sin cita no se muestra' : 'ejercicios sin cita no se muestran'),
  start: 'Empezar los ejercicios',
  another: 'Generar otros',
  preparing: 'Preparando los ejercicios…',
  scoreTitle: 'Ejercicios terminados',
  repeat: 'Repetir con otros ejercicios',
  unanswered: (n) => (n === 1 ? '1 ejercicio sin responder' : `${n} ejercicios sin responder`),
  itemTitle: 'Ejercicio',
  skip: 'Saltar este ejercicio',
  endLabel: 'Terminar los ejercicios aquí',
  endGroup: 'Confirmar el final de los ejercicios',
  endExplain: 'Se terminarán los ejercicios y solo contarán los ejercicios respondidos hasta ahora.'
}

export const modeText = (mode: QuizMode): ModeText => (mode === 'exercises' ? EXERCISES : TEST)
