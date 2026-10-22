import type { ErrorCode, Failure, Result } from '../../shared/api'
import type { IpcEventLike, Listener, Registrar } from './context'

/** Error con código tipado que el renderer puede interpretar (el mensaje es apto para mostrar). */
export class IpcError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly extra?: { count?: number }
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export const invalid = (message: string): IpcError => new IpcError(message, 'INVALID')
export const notFound = (message: string): IpcError => new IpcError(message, 'NOT_FOUND')

const MAX_ERROR_CHARS = 500

/** Solo el mensaje (nunca la pila), acotado. Lo que no es un Error recibe un texto genérico. */
export function safeMessage(e: unknown): string {
  const msg = e instanceof Error && typeof e.message === 'string' ? e.message.trim() : ''
  return (msg || 'Se ha producido un error interno.').slice(0, MAX_ERROR_CHARS)
}

export function toFailure(e: unknown): Failure {
  if (e instanceof IpcError) return { ok: false, error: safeMessage(e), code: e.code, ...(e.extra ?? {}) }
  // El detalle completo se queda en el log del proceso principal; el renderer solo recibe el mensaje.
  console.error('[ipc]', e)
  return { ok: false, error: safeMessage(e), code: 'INTERNAL' }
}

/**
 * Envuelve un handler: devuelve `{ok:true,data}` o `{ok:false,error,code}` y NUNCA lanza.
 * `fn` recibe los argumentos ya sin el evento; puede lanzar IpcError para códigos tipados.
 */
export function handle<T>(
  registrar: Registrar,
  channel: string,
  fn: (event: IpcEventLike, args: unknown[]) => Promise<T> | T
): void {
  const listener: Listener = async (event, ...args) => {
    try {
      const data = await fn(event, args)
      return { ok: true, data } satisfies Result<T>
    } catch (e) {
      try {
        return toFailure(e)
      } catch {
        return { ok: false, error: 'Se ha producido un error interno.', code: 'INTERNAL' } satisfies Failure
      }
    }
  }
  registrar.handle(channel, listener)
}

/** Si `fn` lanza (p. ej. la ventana ya se cerró) se ignora: no debe romper el trabajo en curso. */
export function trySend(event: IpcEventLike, channel: string, payload: unknown): void {
  try {
    if (event.sender.isDestroyed?.()) return
    event.sender.send(channel, payload)
  } catch {
    /* ventana cerrada */
  }
}
