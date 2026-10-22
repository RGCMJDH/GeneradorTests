import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MODEL, loadModel } from '../../src/main/config'

describe('loadModel', () => {
  const withDir = (fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), 'gt-config-'))
    try {
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('por defecto qwen2.5:7b', () => {
    withDir((dir) => expect(loadModel(dir, {})).toBe(DEFAULT_MODEL))
    expect(DEFAULT_MODEL).toBe('qwen2.5:7b')
  })

  it('GT_MODEL gana sobre config.json', () => {
    withDir((dir) => {
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ model: 'del-json:1b' }))
      expect(loadModel(dir, { GT_MODEL: 'del-env:3b' })).toBe('del-env:3b')
      expect(loadModel(dir, {})).toBe('del-json:1b')
    })
  })

  it('ignora config corrupta o con valores no válidos', () => {
    withDir((dir) => {
      writeFileSync(join(dir, 'config.json'), '{no es json')
      expect(loadModel(dir, {})).toBe(DEFAULT_MODEL)
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ model: 42 }))
      expect(loadModel(dir, {})).toBe(DEFAULT_MODEL)
      expect(loadModel(dir, { GT_MODEL: 'con espacios' })).toBe(DEFAULT_MODEL)
      expect(loadModel(dir, { GT_MODEL: '' })).toBe(DEFAULT_MODEL)
    })
  })
})
