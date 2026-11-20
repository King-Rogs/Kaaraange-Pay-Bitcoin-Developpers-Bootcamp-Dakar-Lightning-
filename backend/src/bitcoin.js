'use strict';
/**
 * Bitcoin Core : client JSON-RPC (BTC_MODE=rpc, Polar : polaruser / polarpass)
 * ou chaîne regtest simulée (BTC_MODE=mock) qui en respecte les règles :
 *  - récompense de 50 BTC par bloc, divisée par deux tous les 150 blocs ;
 *  - coinbase dépensable après 100 confirmations supplémentaires (101 blocs) ;
 *  - transactions en mempool, confirmées au bloc suivant ;
 *  - frais fixes de 141 sats (≈ 141 vB à 1 sat/vB) ;
 *  - monnaie rendue considérée comme disponible, comme dans Bitcoin Core.
 * Tous les montants exposés sont en satoshis entiers.
 */
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const { HttpError } = require('./util');

const COIN = 100_000_000;
const MATURITY = 101; // profondeur minimale d'une coinbase dépensable
const HALVING = 150; // regtest
const MOCK_FEE = 141;
const DUST = 546;
const STORE_KEY = 'btc_mock_v1';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const toSat = (btc) => Math.round(Number(btc) * COIN);
const toBtc = (sat) => Number((sat / COIN).toFixed(8));
const randHash = () => crypto.randomBytes(32).toString('hex');
const nowSec = () => Math.floor(Date.now() / 1000);
const subsidy = (height) => Math.floor((50 * COIN) / 2 ** Math.floor(height / HALVING));

function randomAddress() {
  const bytes = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = 'bcrt1q';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BECH32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out + BECH32[(value << (5 - bits)) & 31];
}

const ADDRESS_RE = /^(bcrt1|tb1|bc1)[02-9ac-hj-np-z]{20,90}$|^[mn2][1-9A-HJ-NP-Za-km-z]{25,40}$/;

/* ===================== Chaîne simulée ===================== */

class MockChain {
  constructor() {
    this.s = db.kvGet(STORE_KEY);
    if (!this.s) {
      const genesis = { height: 0, hash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206', prev: null, time: nowSec(), txids: [] };
      this.s = { blocks: [genesis], txs: {}, mempool: [], wallets: {}, spent: {} };
      this.save();
    }
  }
  save() {
    db.kvSet(STORE_KEY, this.s);
  }
  get tip() {
    return this.s.blocks.length - 1;
  }
  owner(address) {
    for (const [name, w] of Object.entries(this.s.wallets)) if (w.addresses.includes(address)) return name;
    return null;
  }

  async chainInfo() {
    const tip = this.s.blocks[this.tip];
    return {
      chain: 'regtest',
      blocks: this.tip,
      bestblockhash: tip.hash,
      difficulty: 4.656542373906925e-10,
      mempool_size: this.s.mempool.length,
      mempool_bytes: this.s.mempool.length * 141,
      time: tip.time,
    };
  }

  blockSummary(b) {
    const size = 285 + b.txids.length * 141;
    return { height: b.height, hash: b.hash, time: b.time, n_tx: b.txids.length, size };
  }

  async blocks(limit = 10) {
    return this.s.blocks.slice(-limit).reverse().map((b) => this.blockSummary(b));
  }

  async block(ref) {
    const b = /^\d+$/.test(String(ref)) ? this.s.blocks[Number(ref)] : this.s.blocks.find((x) => x.hash === ref);
    if (!b) throw new HttpError(404, 'Bloc introuvable.');
    return {
      ...this.blockSummary(b),
      previousblockhash: b.prev,
      confirmations: this.tip - b.height + 1,
      difficulty: 4.656542373906925e-10,
      txs: b.txids.map((id) => this.txView(this.s.txs[id])),
    };
  }

  txView(tx) {
    return {
      txid: tx.txid,
      coinbase: tx.coinbase,
      fee_sat: tx.fee,
      vin: tx.vin.length,
      vout: tx.vout.map((o) => ({ n: o.n, value_sat: o.value, address: o.address })),
    };
  }

  async walletExists(name) {
    return !!this.s.wallets[name];
  }

  async createWallet(name) {
    if (!this.s.wallets[name]) this.s.wallets[name] = { addresses: [], created: nowSec() };
    this.save();
  }

  wallet(name) {
    const w = this.s.wallets[name];
    if (!w) throw new HttpError(404, "Ce portefeuille n'existe pas encore : créez-le d'abord (createwallet).");
    return w;
  }

  async newAddress(name) {
    const w = this.wallet(name);
    const a = randomAddress();
    w.addresses.push(a);
    this.save();
    return a;
  }

  /** Sorties non dépensées d'un portefeuille, avec leur catégorie. */
  utxosOf(name) {
    const w = this.wallet(name);
    const mine = new Set(w.addresses);
    const out = [];
    for (const tx of Object.values(this.s.txs)) {
      const confs = tx.block == null ? 0 : this.tip - tx.block + 1;
      const fromMe = !tx.coinbase && tx.vin.some((i) => mine.has(this.s.txs[i.txid]?.vout[i.vout]?.address));
      for (const o of tx.vout) {
        if (!mine.has(o.address) || this.s.spent[`${tx.txid}:${o.n}`]) continue;
        let kind;
        if (tx.coinbase) kind = confs >= MATURITY ? 'trusted' : 'immature';
        else if (confs > 0) kind = 'trusted';
        else kind = fromMe ? 'trusted' : 'untrusted_pending';
        out.push({ txid: tx.txid, vout: o.n, address: o.address, amount_sat: o.value, confirmations: confs, coinbase: tx.coinbase, kind });
      }
    }
    return out;
  }

  async walletInfo(name) {
    const w = this.wallet(name);
    const utxos = this.utxosOf(name);
    const sum = (k) => utxos.filter((u) => u.kind === k).reduce((s, u) => s + u.amount_sat, 0);
    const mine = new Set(w.addresses);
    const txs = [];
    for (const tx of Object.values(this.s.txs)) {
      const confs = tx.block == null ? 0 : this.tip - tx.block + 1;
      const time = tx.time;
      const fromMe = !tx.coinbase && tx.vin.some((i) => mine.has(this.s.txs[i.txid]?.vout[i.vout]?.address));
      if (fromMe) {
        const sent = tx.vout.filter((o) => !mine.has(o.address));
        for (const o of sent) txs.push({ txid: tx.txid, category: 'send', amount_sat: -o.value, fee_sat: tx.fee, address: o.address, confirmations: confs, time });
        if (!sent.length) txs.push({ txid: tx.txid, category: 'send', amount_sat: 0, fee_sat: tx.fee, address: tx.vout[0]?.address, confirmations: confs, time });
      } else {
        for (const o of tx.vout.filter((x) => mine.has(x.address))) {
          const category = tx.coinbase ? (confs >= MATURITY ? 'generate' : 'immature') : 'receive';
          txs.push({ txid: tx.txid, category, amount_sat: o.value, fee_sat: 0, address: o.address, confirmations: confs, time });
        }
      }
    }
    txs.sort((a, b) => b.time - a.time || a.confirmations - b.confirmations);
    return {
      balances: { trusted_sat: sum('trusted'), untrusted_pending_sat: sum('untrusted_pending'), immature_sat: sum('immature') },
      addresses: w.addresses.slice(-5).reverse(),
      transactions: txs.slice(0, 50),
      utxos: utxos.map(({ kind, ...u }) => ({ ...u, spendable: kind === 'trusted' })).sort((a, b) => b.amount_sat - a.amount_sat),
    };
  }

  async mine(name, n) {
    const address = await this.newAddress(name);
    const hashes = [];
    for (let i = 0; i < n; i += 1) {
      const height = this.tip + 1;
      const included = this.s.mempool.splice(0);
      const fees = included.reduce((s, id) => s + this.s.txs[id].fee, 0);
      const cb = { txid: randHash(), coinbase: true, vin: [], vout: [{ n: 0, value: subsidy(height) + fees, address }], fee: 0, block: height, time: nowSec() };
      this.s.txs[cb.txid] = cb;
      for (const id of included) this.s.txs[id].block = height;
      const prev = this.s.blocks[this.tip];
      const block = { height, hash: randHash(), prev: prev.hash, time: Math.max(nowSec(), prev.time + 1), txids: [cb.txid, ...included] };
      this.s.blocks.push(block);
      hashes.push(block.hash);
    }
    this.save();
    return { address, hashes };
  }

  async send(name, address, sats) {
    const spendable = this.utxosOf(name).filter((u) => u.kind === 'trusted').sort((a, b) => b.amount_sat - a.amount_sat);
    const picked = [];
    let total = 0;
    for (const u of spendable) {
      if (total >= sats + MOCK_FEE) break;
      picked.push(u);
      total += u.amount_sat;
    }
    if (total < sats + MOCK_FEE) throw new HttpError(400, 'Fonds insuffisants (seules les pièces disponibles sont dépensables, frais de 141 sats inclus).', 'amount');
    let fee = MOCK_FEE;
    const vout = [{ n: 0, value: sats, address }];
    const change = total - sats - fee;
    if (change > DUST) vout.push({ n: 1, value: change, address: await this.newAddress(name) });
    else fee += change;
    const tx = { txid: randHash(), coinbase: false, vin: picked.map((u) => ({ txid: u.txid, vout: u.vout })), vout, fee, block: null, time: nowSec() };
    for (const u of picked) this.s.spent[`${u.txid}:${u.vout}`] = tx.txid;
    this.s.txs[tx.txid] = tx;
    this.s.mempool.push(tx.txid);
    this.save();
    return { txid: tx.txid, fee_sat: fee };
  }

  async height() {
    return this.tip;
  }

  heightSync() {
    return this.tip;
  }

  async health() {
    return { reachable: true, chain: 'regtest', blocks: this.tip };
  }
}

/* ===================== Bitcoin Core (JSON-RPC) ===================== */

class RpcChain {
  constructor({ url, user, pass }) {
    this.url = url.replace(/\/$/, '');
    this.auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    this.lastHeight = 0;
  }

  async rpc(method, params = [], wallet = null, timeoutMs = 15000) {
    let res;
    try {
      res = await fetch(wallet ? `${this.url}/wallet/${encodeURIComponent(wallet)}` : this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.auth },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'kaaraange', method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error.name)) throw new HttpError(504, 'Bitcoin Core n’a pas confirmé la réponse dans le délai prévu. L’opération peut encore aboutir : vérifiez son état avant de la relancer.');
      throw new HttpError(502, 'bitcoind injoignable : vérifiez BTC_RPC_URL et que Polar est démarré.');
    }
    if (res.status === 401) throw new HttpError(502, 'bitcoind refuse l’accès : vérifiez BTC_RPC_USER et BTC_RPC_PASS.');
    let body;
    try {
      body = await res.json();
    } catch {
      throw new HttpError(502, `Réponse illisible de bitcoind (HTTP ${res.status}).`);
    }
    if (body.error) {
      const e = new HttpError(400, `bitcoind : ${body.error.message}`);
      e.code = body.error.code;
      throw e;
    }
    return body.result;
  }

  async chainInfo() {
    const [bc, mp, diff] = await Promise.all([this.rpc('getblockchaininfo'), this.rpc('getmempoolinfo'), this.rpc('getdifficulty')]);
    this.lastHeight = bc.blocks;
    return { chain: bc.chain, blocks: bc.blocks, bestblockhash: bc.bestblockhash, difficulty: diff, mempool_size: mp.size, mempool_bytes: mp.bytes, time: bc.time || nowSec() };
  }

  async blocks(limit = 10) {
    const tip = await this.rpc('getblockcount');
    this.lastHeight = tip;
    const heights = [];
    for (let h = tip; h >= 0 && heights.length < limit; h -= 1) heights.push(h);
    return Promise.all(
      heights.map(async (h) => {
        const hash = await this.rpc('getblockhash', [h]);
        const b = await this.rpc('getblock', [hash, 1]);
        return { height: b.height, hash: b.hash, time: b.time, n_tx: b.nTx, size: b.size };
      }),
    );
  }

  async block(ref) {
    let hash = String(ref);
    if (/^\d+$/.test(hash)) hash = await this.rpc('getblockhash', [Number(ref)]).catch(() => null);
    if (!hash) throw new HttpError(404, 'Bloc introuvable.');
    const b = await this.rpc('getblock', [hash, 2]).catch(() => {
      throw new HttpError(404, 'Bloc introuvable.');
    });
    return {
      height: b.height,
      hash: b.hash,
      time: b.time,
      n_tx: b.nTx,
      size: b.size,
      previousblockhash: b.previousblockhash || null,
      confirmations: b.confirmations,
      difficulty: b.difficulty,
      txs: b.tx.map((t) => ({
        txid: t.txid,
        coinbase: !!t.vin[0]?.coinbase,
        fee_sat: t.fee != null ? toSat(t.fee) : 0,
        vin: t.vin.length,
        vout: t.vout.map((o) => ({ n: o.n, value_sat: toSat(o.value), address: o.scriptPubKey?.address || null })),
      })),
    };
  }

  async walletExists(name) {
    const loaded = await this.rpc('listwallets');
    if (loaded.includes(name)) return true;
    try {
      await this.rpc('loadwallet', [name]);
      return true;
    } catch {
      return false;
    }
  }

  async createWallet(name) {
    if (await this.walletExists(name)) return;
    await this.rpc('createwallet', [name]);
  }

  async ensure(name) {
    if (!(await this.walletExists(name))) throw new HttpError(404, "Ce portefeuille n'existe pas encore : créez-le d'abord (createwallet).");
  }

  async newAddress(name) {
    await this.ensure(name);
    return this.rpc('getnewaddress', ['kaaraange', 'bech32'], name);
  }

  async walletInfo(name) {
    await this.ensure(name);
    const [bal, txs, utxos, addrs] = await Promise.all([
      this.rpc('getbalances', [], name),
      this.rpc('listtransactions', ['*', 50, 0, true], name),
      this.rpc('listunspent', [0], name),
      this.rpc('getaddressesbylabel', ['kaaraange'], name).catch(() => ({})),
    ]);
    return {
      balances: {
        trusted_sat: toSat(bal.mine.trusted),
        untrusted_pending_sat: toSat(bal.mine.untrusted_pending),
        immature_sat: toSat(bal.mine.immature),
      },
      addresses: Object.keys(addrs).slice(-5).reverse(),
      transactions: txs
        .map((t) => ({ txid: t.txid, category: t.category, amount_sat: toSat(t.amount), fee_sat: t.fee ? -toSat(t.fee) : 0, address: t.address, confirmations: t.confirmations, time: t.time }))
        .reverse(),
      utxos: utxos
        .map((u) => ({ txid: u.txid, vout: u.vout, address: u.address, amount_sat: toSat(u.amount), confirmations: u.confirmations, coinbase: false, spendable: u.spendable && u.safe !== false }))
        .sort((a, b) => b.amount_sat - a.amount_sat),
    };
  }

  async mine(name, n) {
    const info = await this.rpc('getblockchaininfo');
    if (info.chain !== 'regtest') throw new HttpError(400, 'Le minage n’est possible qu’en regtest.');
    const address = await this.newAddress(name);
    const hashes = await this.rpc('generatetoaddress', [n, address], null, config.btcMineTimeoutMs);
    return { address, hashes };
  }

  async send(name, address, sats) {
    await this.ensure(name);
    try {
      // Paramètres nommés : fee_rate en sat/vB (le regtest n'a pas d'estimation de frais).
      const res = await fetch(`${this.url}/wallet/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: this.auth },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'kaaraange', method: 'sendtoaddress', params: { address, amount: toBtc(sats), fee_rate: 1 } }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json();
      if (body.error) throw new HttpError(400, /insufficient/i.test(body.error.message) ? 'Fonds insuffisants.' : `bitcoind : ${body.error.message}`, 'amount');
      const tx = await this.rpc('gettransaction', [body.result], name).catch(() => null);
      return { txid: body.result, fee_sat: tx && tx.fee ? -toSat(tx.fee) : null };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'bitcoind injoignable.');
    }
  }

  async height() {
    this.lastHeight = await this.rpc('getblockcount');
    return this.lastHeight;
  }

  heightSync() {
    return this.lastHeight;
  }

  async health() {
    try {
      const bc = await this.rpc('getblockchaininfo');
      this.lastHeight = bc.blocks;
      return { reachable: true, chain: bc.chain, blocks: bc.blocks };
    } catch (e) {
      return { reachable: false, error: e.message };
    }
  }
}

let chain = null;
function init() {
  chain = config.btcMode === 'rpc' ? new RpcChain(config.btcRpc) : new MockChain();
  return chain;
}

module.exports = { init, get chain() { return chain; }, ADDRESS_RE, toBtc, toSat, MATURITY, MOCK_FEE };
