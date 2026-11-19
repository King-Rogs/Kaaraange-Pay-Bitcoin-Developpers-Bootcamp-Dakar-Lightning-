'use strict';
/**
 * Cours BTC → FCFA côté serveur (sert au calcul des frais en sats).
 * Source : Binance BTCEUR × 655,957 (parité fixe du franc CFA),
 * repli CoinGecko (EUR), puis repli BTC_XOF_FALLBACK.
 */
const config = require('./config');

const XOF_PER_EUR = 655.957;
const TTL_MS = 60_000;

let cache = { btc_xof: config.btcXofFallback, source: 'repli', updated_at: 0 };
let inflight = null;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refresh() {
  try {
    const j = await fetchJson('https://api.binance.com/api/v3/ticker/price?symbol=BTCEUR');
    const eur = Number(j.price);
    if (eur > 0) return { btc_xof: eur * XOF_PER_EUR, source: 'Binance BTCEUR', updated_at: Date.now() };
  } catch {
    /* repli suivant */
  }
  try {
    const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur');
    const eur = Number(j?.bitcoin?.eur);
    if (eur > 0) return { btc_xof: eur * XOF_PER_EUR, source: 'CoinGecko EUR', updated_at: Date.now() };
  } catch {
    /* repli final */
  }
  return { btc_xof: config.btcXofFallback, source: 'repli (BTC_XOF_FALLBACK)', updated_at: Date.now() };
}

/** Cours courant (mis en cache 60 s). */
async function get() {
  if (config.priceMode === 'fixed') return { btc_xof: config.btcXofFallback, source: 'fixe (PRICE_MODE=fixed)', updated_at: Date.now() };
  if (Date.now() - cache.updated_at < TTL_MS) return cache;
  if (!inflight) {
    inflight = refresh()
      .then((c) => {
        cache = c;
        return c;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

const xofToSat = (xof, btcXof) => Math.max(1, Math.ceil((xof / btcXof) * 1e8));
const satToXof = (sat, btcXof) => (sat / 1e8) * btcXof;

module.exports = { get, xofToSat, satToXof, XOF_PER_EUR };
