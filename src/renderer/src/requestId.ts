/** Identificador de petición para cancelar/seguir trabajos largos (cumple /^[A-Za-z0-9_-]{1,64}$/). */
export const newRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
