import { channels, type HealthDto } from '../../shared/api'
import { handle } from './common'
import type { IpcContext, Registrar } from './context'
import { arity } from './validate'

const DEFAULT_HARD_CAP_MS = 5000

export function registerSystem(ctx: IpcContext, r: Registrar): void {
  handle(r, channels.systemHealth, async (_e, args): Promise<HealthDto> => {
    arity(args, 0)
    // OllamaProvider.health() ya corta a los 3 s; este tope protege además de proveedores que no lo hagan.
    let timer: ReturnType<typeof setTimeout> | undefined
    const capped = new Promise<{ ok: boolean; message: string }>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, message: 'Ollama no responde. Comprueba que esté en ejecución («ollama serve»).' }),
        ctx.healthTimeoutMs ?? DEFAULT_HARD_CAP_MS
      )
    })
    try {
      const h = await Promise.race([ctx.llm.health(), capped])
      return { ok: h.ok, message: h.message, model: ctx.model }
    } catch {
      return { ok: false, message: 'No se pudo comprobar el estado de Ollama.', model: ctx.model }
    } finally {
      clearTimeout(timer)
    }
  })

  handle(r, channels.systemConfig, (_e, args) => {
    arity(args, 0)
    return { model: ctx.model }
  })
}
