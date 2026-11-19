const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const sats = (n: number) => nf0.format(n)
export const int = (n: number) => nf0.format(Math.round(n))
export const usd = (n: number) => `${nf2.format(n)} $`
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${nf2.format(n)} %`

export function compact(n: number) {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Satoshis → BTC, format français, jusqu'à 8 décimales, sans zéro inutile. */
export function btc(sats: number) {
  return (sats / 1e8).toLocaleString('fr-FR', { maximumFractionDigits: 8 })
}

export function timeLeft(s: number) {
  if (s <= 0) return 'expiré'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h} h ${String(m).padStart(2, '0')}`
  return `${m} min ${String(s % 60).padStart(2, '0')} s`
}

export function dateTime(ts: number) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(ts * 1000)
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

/** 1 EUR = 655,957 FCFA (parité fixe du franc CFA). */
export const XOF_PER_EUR = 655.957
