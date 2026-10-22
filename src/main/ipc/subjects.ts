import { channels } from '../../shared/api'
import { handle, notFound } from './common'
import type { IpcContext, Registrar } from './context'
import { arity, MAX_NAME, str } from './validate'

/** La asignatura debe existir; si no, NOT_FOUND (evita errores de clave foránea opacos). */
export function requireSubject(ctx: IpcContext, subjectId: number): void {
  if (!ctx.store.listSubjects().some((s) => s.id === subjectId)) throw notFound(`La asignatura ${subjectId} no existe.`)
}

export function registerSubjects(ctx: IpcContext, r: Registrar): void {
  handle(r, channels.subjectsList, (_e, args) => {
    arity(args, 0)
    return ctx.store.listSubjects()
  })

  handle(r, channels.subjectsCreate, (_e, args) => {
    arity(args, 1)
    return ctx.store.createSubject(str(args[0], 'El nombre', MAX_NAME, { trim: true }))
  })
}
