import type { IpcContext, Registrar } from './context'
import { registerNotes } from './notes'
import { registerQuiz } from './quiz'
import { registerSubjects } from './subjects'
import { registerSystem } from './system'

export type { IpcContext, Registrar, DialogLike, CoreFns } from './context'
export { realCore } from './context'
export { ingestImageFromPath } from './notes'

/** Registra todos los handlers. `registrar` es `ipcMain` en la app y un doble en las pruebas. */
export function registerIpc(ctx: IpcContext, registrar: Registrar): void {
  registerSubjects(ctx, registrar)
  registerNotes(ctx, registrar)
  registerQuiz(ctx, registrar)
  registerSystem(ctx, registrar)
}
