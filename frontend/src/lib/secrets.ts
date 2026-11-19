/**
 * Le code de livraison (preimage) est créé sur l'appareil de l'acheteur.
 * Seul son hash SHA-256 est envoyé au serveur. Le code reste dans ce navigateur.
 */
const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function newDeliverySecret() {
  const preimage = crypto.getRandomValues(new Uint8Array(32))
  const hash = await crypto.subtle.digest('SHA-256', preimage)
  return { preimage: toHex(preimage), hash: toHex(hash) }
}

const KEY = 'kp-delivery-codes'
let memory: Record<string, string> = {}

function load(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return memory
  }
}

export function saveCode(orderId: string, code: string) {
  const all = { ...load(), [orderId]: code }
  memory = all
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* stockage indisponible : on garde en mémoire */
  }
}

export const getCode = (orderId: string): string | undefined => load()[orderId]

export const groupCode = (hex: string) => hex.match(/.{1,8}/g)?.join(' ') ?? hex
