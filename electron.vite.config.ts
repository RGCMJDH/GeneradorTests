import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * El index.html lleva la CSP estricta de producción (`script-src 'self'`). El servidor de desarrollo
 * necesita además un script inline (preámbulo de React Fast Refresh), así que SOLO en `serve` se relaja script-src.
 */
const devCspRelaxation = (): Plugin => ({
  name: 'gt-dev-csp',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@core': resolve('src/core') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), devCspRelaxation()],
    resolve: { alias: { '@core': resolve('src/core') } }
  }
})
