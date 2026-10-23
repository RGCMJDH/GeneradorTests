import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) } },
  test: {
    environment: 'node',
    // Los tests de UI activan jsdom con el docblock `// @vitest-environment jsdom`.
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Los tests de UI a nivel de App son pesados y con muchos workers en paralelo superaban los 5 s por defecto.
    testTimeout: 15000,
    hookTimeout: 15000
  }
})
