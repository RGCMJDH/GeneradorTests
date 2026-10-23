import { vi } from 'vitest'
import { request, type IncomingHttpHeaders } from 'node:http'
import { connect } from 'node:net'
import { startUploadServer } from '@core/mobile'

export type Server = Awaited<ReturnType<typeof startUploadServer>>
export type OnImage = (data: Buffer, filename: string) => Promise<void>

export const started: Server[] = []
export const stopAll = async (): Promise<void> => void (await Promise.all(started.splice(0).map((s) => s.stop())))

export async function start(over: Partial<Parameters<typeof startUploadServer>[0]> = {}, onImage?: OnImage) {
  const spy = vi.fn<OnImage>(onImage ?? (async () => undefined))
  const server = await startUploadServer({ onImage: spy, host: '127.0.0.1', port: 0, ...over })
  started.push(server)
  const u = new URL(server.url)
  return { server, spy, origin: u.origin, base: u.pathname, port: Number(u.port), host: u.host }
}

export interface Reply {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  text: string
}

export function send(origin: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(origin)
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body)
    const headers: Record<string, string | number> = { ...opts.headers }
    if (body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')) headers['Content-Length'] = body.length
    const r = request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers, agent: false }, (res) => {
      const parts: Buffer[] = []
      res.on('data', (c: Buffer) => parts.push(c))
      res.on('end', () => {
        const b = Buffer.concat(parts)
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b, text: b.toString('utf8') })
      })
      res.on('error', reject)
    })
    r.on('error', reject)
    r.end(body)
  })
}

export const upload = (s: { origin: string; base: string }, body: Buffer | string, type = 'image/png', extra: Record<string, string> = {}) =>
  send(s.origin, `${s.base}/upload`, { method: 'POST', headers: { 'Content-Type': type, ...extra }, body })

export function rawExchange(port: number, payload: string, waitMs = 3000): Promise<{ closed: boolean; data: string }> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1')
    let data = ''
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ closed: false, data })
    }, waitMs)
    sock.on('connect', () => sock.write(payload))
    sock.on('data', (c) => (data += c.toString('latin1')))
    sock.on('error', () => undefined)
    sock.on('close', () => {
      clearTimeout(timer)
      resolve({ closed: true, data })
    })
  })
}
