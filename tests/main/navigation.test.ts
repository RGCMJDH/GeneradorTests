import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { isAllowedNavigation } from '../../src/main/navigation'

const indexUrl = pathToFileURL('C:/app/out/renderer/index.html').href

describe('isAllowedNavigation (producción)', () => {
  const cfg = { indexUrl }
  it('permite exactamente el index.html de la app', () => {
    expect(isAllowedNavigation(indexUrl, cfg)).toBe(true)
  })
  it('ignora solo el hash', () => {
    expect(isAllowedNavigation(indexUrl + '#chunk-3', cfg)).toBe(true)
  })
  it('deniega otros file://', () => {
    expect(isAllowedNavigation('file:///C:/Windows/win.ini', cfg)).toBe(false)
    expect(isAllowedNavigation(pathToFileURL('C:/app/out/renderer/otra.html').href, cfg)).toBe(false)
    expect(isAllowedNavigation(indexUrl + '?x=1', cfg)).toBe(false)
  })
  it('deniega http(s) y esquemas raros', () => {
    expect(isAllowedNavigation('https://evil.com/', cfg)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5173/', cfg)).toBe(false)
    expect(isAllowedNavigation('javascript:alert(1)', cfg)).toBe(false)
    expect(isAllowedNavigation('not a url', cfg)).toBe(false)
    expect(isAllowedNavigation('', cfg)).toBe(false)
  })
})

describe('isAllowedNavigation (desarrollo)', () => {
  const cfg = { devUrl: 'http://localhost:5173', indexUrl }
  it('permite el origen del servidor de desarrollo', () => {
    expect(isAllowedNavigation('http://localhost:5173/', cfg)).toBe(true)
    expect(isAllowedNavigation('http://localhost:5173/src/main.tsx', cfg)).toBe(true)
  })
  it('deniega el truco de userinfo y prefijos de host', () => {
    expect(isAllowedNavigation('http://localhost:5173@evil.com/', cfg)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5173.evil.com/', cfg)).toBe(false)
  })
  it('deniega otros puertos, esquemas y file://', () => {
    expect(isAllowedNavigation('http://localhost:5174/', cfg)).toBe(false)
    expect(isAllowedNavigation('https://localhost:5173/', cfg)).toBe(false)
    expect(isAllowedNavigation(indexUrl, cfg)).toBe(false)
  })
  it('una redirección se evalúa con la misma regla', () => {
    expect(isAllowedNavigation('http://localhost:5173/login', cfg)).toBe(true)
    expect(isAllowedNavigation('https://evil.com/phish', cfg)).toBe(false)
  })
  it('con devUrl inválido deniega todo', () => {
    expect(isAllowedNavigation('http://localhost:5173/', { devUrl: 'basura', indexUrl })).toBe(false)
  })
})
