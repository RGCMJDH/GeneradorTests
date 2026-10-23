import type { IpcContext, Registrar } from './context'
import { registerConcepts } from './concepts'
import { registerMobile } from './mobile'
import { registerNotes } from './notes'
import { registerQuiz } from './quiz'
import { registerSubjects } from './subjects'
import { registerSystem } from './system'

export type { IpcContext, Registrar, DialogLike, CoreFns, MobileDeps } from './context'
export { realCore } from './context'
export { ingestImageFromPath } from './notes'

/** Registra todos los handlers. `registrar` es `ipcMain` en la app y un doble en las pruebas. */
export function registerIpc(ctx: IpcContext, registrar: Registrar): { dispose(): Promise<void> } {
  registerSubjects(ctx, registrar)
  registerNotes(ctx, registrar)
  registerQuiz(ctx, registrar)
  registerConcepts(ctx, registrar)
  registerSystem(ctx, registrar)
  const mobile = registerMobile(ctx, registrar)
  // `dispose` se llama al salir de la app: cierra el servidor de subida del móvil si sigue abierto.
  return { dispose: () => mobile.dispose() }
}
