import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
