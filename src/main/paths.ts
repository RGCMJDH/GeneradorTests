import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Empaquetado, los archivos listados en `asarUnpack` viven en `app.asar.unpacked` en vez de dentro de `app.asar`.
 * Los Worker de worker_threads y los .wasm cargados por ruta necesitan archivos reales, así que se reescribe la ruta.
 * Si la ruta no está dentro de un asar, o la copia desempaquetada no existe, se devuelve tal cual (desarrollo y tests).
 */
export function toUnpacked(path: string, exists: (p: string) => boolean = existsSync): string {
  const rewritten = path.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked')
  return rewritten !== path && exists(rewritten) ? rewritten : path
}

/** Carpeta de sql.js/dist (contiene sql-wasm.wasm). */
export const sqlWasmDir = (resolve: (id: string) => string = require.resolve): string =>
  toUnpacked(dirname(resolve('sql.js/dist/sql-wasm.wasm')))

/** Script del worker de Tesseract (Node/worker_threads). Fuera del asar cuando la app está empaquetada. */
export const tesseractWorkerPath = (resolve: (id: string) => string = require.resolve): string =>
  toUnpacked(resolve('tesseract.js/src/worker-script/node/index.js'))
