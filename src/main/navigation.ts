/** Configuración de la guardia de navegación del renderer. */
export interface NavigationConfig {
  /** URL del servidor de Vite (solo en desarrollo). */
  devUrl?: string
  /** URL `file://` exacta del index.html empaquetado. */
  indexUrl: string
}

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Decide si `will-navigate` / `will-redirect` puede seguir adelante. Comparación EXACTA, no por prefijo:
 * - desarrollo: mismo origen que el servidor de Vite (`http://localhost:5173@evil.com/` tiene origen evil.com);
 * - producción: solo el index.html de la app (se ignora únicamente el #hash, que no cambia de documento).
 */
export function isAllowedNavigation(url: string, cfg: NavigationConfig): boolean {
  const target = parse(url)
  if (!target) return false
  if (cfg.devUrl) {
    const dev = parse(cfg.devUrl)
    return dev !== null && dev.origin !== 'null' && target.origin === dev.origin
  }
  const index = parse(cfg.indexUrl)
  if (!index || target.protocol !== 'file:') return false
  target.hash = ''
  index.hash = ''
  return target.href === index.href
}
