import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_MODEL = 'qwen2.5:7b'
const MAX_MODEL_CHARS = 100

const valid = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_MODEL_CHARS && !/\s/.test(v)

/**
 * Modelo de Ollama: variable GT_MODEL, si no `config.json` ({"model": "..."}) en userData, si no el de por defecto.
 * Nunca lanza: un config.json ausente o corrupto se ignora.
 */
export function loadModel(userDataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (valid(env['GT_MODEL'])) return env['GT_MODEL']
  try {
    const cfg = JSON.parse(readFileSync(join(userDataDir, 'config.json'), 'utf8')) as { model?: unknown }
    if (valid(cfg?.model)) return cfg.model
  } catch {
    /* sin configuración */
  }
  return DEFAULT_MODEL
}
