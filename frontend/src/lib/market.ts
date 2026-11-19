/**
 * Cours du Bitcoin en temps réel.
 * Source principale : flux WebSocket public de Binance (BTC/USDT).
 * Repli : API REST Binance, puis CoinGecko (sondage toutes les 15 s).
 * Une seule connexion est partagée par toute l'application.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { XOF_PER_EUR } from './format'

export type Ticker = {
  price: number
  changePct: number
  changeAbs: number
  high: number
  low: number
  volumeBtc: number
  volumeUsd: number
  updatedAt: number
}
export type MarketState = {
  ticker: Ticker | null
  eurUsd: number | null
  status: 'connecting' | 'live' | 'polling' | 'offline'
  dir: 'up' | 'down' | null
  candle: { t: number; c: number } | null
}

const REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com']
const WS_URL = 'wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/btcusdt@kline_1m'
const GECKO = 'https://api.coingecko.com/api/v3'

let state: MarketState = { ticker: null, eurUsd: null, status: 'connecting', dir: null, candle: null }
const listeners = new Set<() => void>()
let started = false
let pollTimer: number | undefined

/**
 * Le flux WebSocket Binance peut émettre plusieurs mises à jour par seconde.
 * Sans limite, chaque tick re-rend tous les composants abonnés (bandeau,
 * graphe, badges…) en même temps, ce qui fait « trembler » la page. On
 * limite donc les re-rendus à un par fenêtre de NOTIFY_MS, tout en gardant
 * `state` toujours à jour pour la prochaine lecture.
 */
const NOTIFY_MS = 400
let lastNotify = 0
let notifyTimer: number | undefined

function notify() {
  lastNotify = Date.now()
  notifyTimer = undefined
  listeners.forEach((l) => l())
}

function scheduleNotify() {
  const elapsed = Date.now() - lastNotify
  if (elapsed >= NOTIFY_MS) notify()
  else if (notifyTimer === undefined) notifyTimer = window.setTimeout(notify, NOTIFY_MS - elapsed)
}

function set(patch: Partial<MarketState>) {
  state = { ...state, ...patch }
  scheduleNotify()
}

function setPrice(t: Ticker) {
  const prev = state.ticker?.price
  set({ ticker: t, dir: prev == null || prev === t.price ? state.dir : t.price > prev ? 'up' : 'down' })
}

async function binance<T>(path: string): Promise<T> {
  let last: unknown
  for (const host of REST_HOSTS) {
    try {
      const r = await fetch(host + path)
      if (r.ok) return (await r.json()) as T
      last = new Error(String(r.status))
    } catch (e) {
      last = e
    }
  }
  throw last
}

type Raw24h = { lastPrice: string; priceChangePercent: string; priceChange: string; highPrice: string; lowPrice: string; volume: string; quoteVolume: string }

function markPolled() {
  if (state.status === 'connecting' || state.status === 'offline') set({ status: 'polling' })
}

async function pollOnce() {
  try {
    const d = await binance<Raw24h>('/api/v3/ticker/24hr?symbol=BTCUSDT')
    setPrice({
      price: +d.lastPrice, changePct: +d.priceChangePercent, changeAbs: +d.priceChange,
      high: +d.highPrice, low: +d.lowPrice, volumeBtc: +d.volume, volumeUsd: +d.quoteVolume, updatedAt: Date.now(),
    })
    markPolled()
    return true
  } catch {
    try {
      const r = await fetch(`${GECKO}/simple/price?ids=bitcoin&vs_currencies=usd,eur&include_24hr_change=true&include_24hr_vol=true`)
      const d = (await r.json()).bitcoin
      const price = d.usd as number
      const changePct = d.usd_24h_change as number
      setPrice({
        price, changePct, changeAbs: price - price / (1 + changePct / 100),
        high: state.ticker?.high ?? price, low: state.ticker?.low ?? price,
        volumeBtc: (d.usd_24h_vol as number) / price, volumeUsd: d.usd_24h_vol, updatedAt: Date.now(),
      })
      if (d.eur) set({ eurUsd: price / d.eur })
      markPolled()
      return true
    } catch {
      return false
    }
  }
}

function startPolling() {
  if (pollTimer) return
  if (state.status !== 'live') set({ status: 'polling' })
  const tick = async () => {
    const ok = await pollOnce()
    if (!ok && !state.ticker) set({ status: 'offline' })
  }
  tick()
  pollTimer = window.setInterval(tick, 15000)
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = undefined
}

function connect() {
  let ws: WebSocket
  try {
    ws = new WebSocket(WS_URL)
  } catch {
    startPolling()
    return
  }
  // Si le flux ne s'ouvre pas en 8 s (réseau filtré), on bascule sur le sondage
  const guard = window.setTimeout(() => ws.readyState !== WebSocket.OPEN && ws.close(), 8000)
  ws.onopen = () => {
    window.clearTimeout(guard)
    stopPolling()
    set({ status: 'live' })
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const d = msg.data
    if (!d) return
    if (d.e === '24hrTicker') {
      setPrice({
        price: +d.c, changePct: +d.P, changeAbs: +d.p, high: +d.h, low: +d.l,
        volumeBtc: +d.v, volumeUsd: +d.q, updatedAt: d.E,
      })
    } else if (d.e === 'kline') {
      set({ candle: { t: d.k.t, c: +d.k.c } })
    }
  }
  ws.onclose = () => {
    startPolling()
    window.setTimeout(connect, 20000) // nouvelle tentative de flux temps réel
  }
  ws.onerror = () => ws.close()
}

async function loadEurUsd() {
  try {
    const d = await binance<{ price: string }>('/api/v3/ticker/price?symbol=EURUSDT')
    set({ eurUsd: +d.price })
  } catch {
    /* CoinGecko le fournira en repli */
  }
}

function start() {
  if (started) return
  started = true
  pollOnce()
  loadEurUsd()
  connect()
}

export function useMarket(): MarketState {
  useEffect(start, [])
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Conversions FCFA ↔ BTC (le FCFA est arrimé à l'euro : 1 € = 655,957 FCFA). */
export function useConversions() {
  const m = useMarket()
  const usdPerXof = m.eurUsd ? m.eurUsd / XOF_PER_EUR : null
  const btcXof = m.ticker && usdPerXof ? m.ticker.price / usdPerXof : null
  return {
    btcXof,
    satsToXof: (s: number) => (btcXof ? (s / 1e8) * btcXof : null),
    xofToSats: (x: number) => (btcXof ? (x / btcXof) * 1e8 : null),
  }
}

// ---------------------------------------------------------------- historique
export type Range = '1H' | '24H' | '7J' | '30J'
const RANGES: Record<Range, { interval: string; limit: number; days: number }> = {
  '1H': { interval: '1m', limit: 60, days: 1 },
  '24H': { interval: '15m', limit: 96, days: 1 },
  '7J': { interval: '1h', limit: 168, days: 7 },
  '30J': { interval: '4h', limit: 180, days: 30 },
}
export type Point = { t: number; p: number }

export function useHistory(range: Range) {
  const [points, setPoints] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const { candle, ticker } = useMarket()

  useEffect(() => {
    let alive = true
    setLoading(true)
    const cfg = RANGES[range]
    ;(async () => {
      let pts: Point[] = []
      try {
        const rows = await binance<[number, string, string, string, string][]>(
          `/api/v3/klines?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`,
        )
        pts = rows.map((r) => ({ t: r[0], p: +r[4] }))
      } catch {
        try {
          const r = await fetch(`${GECKO}/coins/bitcoin/market_chart?vs_currency=usd&days=${cfg.days}`)
          const d = await r.json()
          const all: Point[] = (d.prices as [number, number][]).map(([t, p]) => ({ t, p }))
          const from = range === '1H' ? Date.now() - 3600_000 : 0
          pts = all.filter((x) => x.t >= from)
        } catch {
          pts = []
        }
      }
      if (alive) {
        setPoints(pts)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [range])

  // Mise à jour en direct du dernier point
  useEffect(() => {
    if (!points.length) return
    setPoints((prev) => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]!
      if (range === '1H' && candle) {
        if (candle.t > last.t) return [...prev.slice(1), { t: candle.t, p: candle.c }]
        if (candle.t === last.t) return [...prev.slice(0, -1), { t: last.t, p: candle.c }]
        return prev
      }
      if (ticker && ticker.price !== last.p) return [...prev.slice(0, -1), { t: last.t, p: ticker.price }]
      return prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candle?.c, candle?.t, ticker?.price, range])

  return { points, loading }
}
