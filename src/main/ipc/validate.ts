import { invalid } from './common'

export const MAX_NAME = 100
export const MAX_TOPIC = 200
export const MAX_NOTES_TEXT = 2_000_000
export const MAX_ANSWER = 20_000
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Rechaza argumentos de más (y de menos): ningún handler acepta parámetros extra, p. ej. una ruta. */
export function arity(args: unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max)
    throw invalid(`Número de argumentos no válido (se esperaban ${min === max ? min : `${min}-${max}`}).`)
}

export function id(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw invalid(`${name} no es un identificador válido.`)
  return v
}

export function optId(v: unknown, name: string): number | undefined {
  return v === undefined ? undefined : id(v, name)
}

export function str(v: unknown, name: string, max: number, opts: { allowEmpty?: boolean; trim?: boolean } = {}): string {
  if (typeof v !== 'string') throw invalid(`${name} debe ser texto.`)
  const s = opts.trim ? v.trim() : v
  if (!opts.allowEmpty && s.trim() === '') throw invalid(`${name} no puede estar vacío.`)
  if (s.length > max) throw invalid(`${name} es demasiado largo (máximo ${max} caracteres).`)
  return s
}

export function requestId(v: unknown): string {
  if (typeof v !== 'string' || !REQUEST_ID.test(v)) throw invalid('requestId no válido.')
  return v
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], name: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw invalid(`${name} no es válido.`)
  return v as T
}

/** Objeto plano con solo las claves permitidas (cualquier otra, p. ej. `path`, se rechaza). */
export function record(v: unknown, allowed: readonly string[], name: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw invalid(`${name} debe ser un objeto.`)
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw invalid(`${name}: campo no permitido «${k}».`)
  return v as Record<string, unknown>
}
