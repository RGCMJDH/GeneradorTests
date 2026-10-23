import type { NetworkInterfaceInfo } from 'node:os'

const MAX_FILENAME = 100
const VIRTUAL_ADAPTER = /vethernet|virtualbox|vmware|vmnet|wsl|docker|hyper-v|vpn|tailscale|zerotier|loopback|bluetooth/i

const isPrivate = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
const WIFI_ADAPTER = /wi-?fi|wlan|wireless|inal[aá]mbric|^en0$/i
/** Rango por defecto de la red «solo anfitrión» de VirtualBox: el móvil nunca llega ahí. */
const HOST_ONLY_RANGE = /^192\.168\.56\./

/**
 * IPv4 de la red local donde el móvil puede llegar al ordenador. Descarta loopback/IPv6/enlace local y puntúa el resto:
 * mejor rangos privados y adaptadores wifi; peor adaptadores virtuales (WSL, Hyper-V, VirtualBox, Docker, VPN).
 * Null si no hay ninguna. Nunca devuelve «todas las interfaces».
 */
export function pickLanAddress(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const found: Array<{ ip: string; score: number }> = []
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.internal || (i.family !== 'IPv4' && (i.family as unknown) !== 4) || i.address.startsWith('169.254.')) continue
      const score = (isPrivate(i.address) ? 0 : 3) + (VIRTUAL_ADAPTER.test(name) ? 2 : 0) + (HOST_ONLY_RANGE.test(i.address) ? 2 : 0) - (WIFI_ADAPTER.test(name) ? 1 : 0)
      found.push({ ip: i.address, score })
    }
  }
  found.sort((a, b) => a.score - b.score) // sort estable: a igual puntuación manda el orden del sistema
  return found[0]?.ip ?? null
}

/** Nombre solo informativo: sin separadores de ruta, sin caracteres de control ni reservados, acotado. */
export function sanitizeFilename(raw: string | undefined): string {
  let name = raw ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    /* percent-encoding inválido: se usa tal cual */
  }
  name = name.slice(name.search(/[^/\\]*$/)) // solo lo posterior al último separador
  name = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^[.\s]+/, '').trim().slice(0, MAX_FILENAME)
  return name === '' || /^_+$/.test(name) ? 'foto' : name
}
