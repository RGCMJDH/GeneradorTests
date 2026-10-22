import { afterEach } from 'vitest'

// Solo en entornos con DOM (tests de UI con `@vitest-environment jsdom`); los tests de core siguen en node.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
  })
}
