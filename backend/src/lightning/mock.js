'use strict';
/**
 * Réseau Lightning simulé en mémoire (LND_MODE=mock).
 *
 * Trois nœuds (alice, bob, carol) et deux canaux, comme dans Polar :
 *   alice ──2 000 000 sats──▶ bob ──1 000 000 sats──▶ carol
 *
 * Le comportement imite LND :
 *  - factures classiques et hold invoices (OPEN → ACCEPTED → SETTLED / CANCELED) ;
 *  - recherche de chemin par parcours en largeur, filtré par la liquidité ;
 *  - HTLC verrouillés sur chaque canal du chemin tant que la facture est en attente ;
 *  - frais de routage (1 sat + 1 ppm) prélevés par chaque nœud intermédiaire ;
 *  - liquidité qui passe du payeur au destinataire au règlement,
 *    et qui revient au payeur à l'annulation ;
 *  - preimage révélée au payeur une fois la facture réglée.
 *
 * Les erreurs sont levées au format ln-service : [code, 'NomErreur', détails].
 * L'état est persisté (table kv) pour survivre aux redémarrages du serveur.
 */
const crypto = require('node:crypto');

const STORE_KEY = 'ln_mock_v1';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ROUTING_BASE_FEE = 1; // sat
const ROUTING_PPM = 1; // parties par million

const sha256 = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
const nowIso = () => new Date().toISOString();
const nowSec = () => Math.floor(Date.now() / 1000);

function bech32ish(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BECH32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BECH32[(value << (5 - bits)) & 31];
  return out;
}

/** Partie montant d'une facture BOLT11 (lnbcrt…) : m = 0,001 BTC, u = 100 sats, n = 0,1 sat. */
function amountHrp(sats) {
  if (sats % 100_000 === 0) return `${sats / 100_000}m`;
  if (sats % 100 === 0) return `${sats / 100}u`;
  return `${sats * 10}n`;
}

function routingFee(amount) {
  return ROUTING_BASE_FEE + Math.floor((amount * ROUTING_PPM) / 1_000_000);
}

function initialState() {
  const node = (alias, color, onchain) => ({
    alias,
    color,
    public_key: `02${sha256(Buffer.from(`kaaraange-${alias}`).toString('hex'))}`,
    onchain_sat: onchain,
  });
  return {
    nodes: {
      alice: node('alice', '#3b82f6', 3_000_000),
      bob: node('bob', '#22c55e', 2_000_000),
      carol: node('carol', '#a855f7', 2_000_000),
    },
    channels: [
      { id: '103x1x0', a: 'alice', b: 'bob', capacity: 2_000_000, bal: { alice: 2_000_000, bob: 0 }, pending: 0 },
      { id: '103x2x0', a: 'bob', b: 'carol', capacity: 1_000_000, bal: { bob: 1_000_000, carol: 0 }, pending: 0 },
    ],
    invoices: {}, // payment_hash → facture
    payments: {}, // payment_hash → paiement sortant
    addresses: 0,
    startedAt: nowSec(),
  };
}

class MockNetwork {
  /**
   * @param {{ load: () => any, save: (s: any) => void }} store
   * @param {() => number} heightFn hauteur de bloc courante (chaîne simulée)
   */
  constructor(store, heightFn) {
    this.store = store;
    this.heightFn = heightFn || (() => 0);
    this.state = (store && store.load()) || initialState();
    this.waiters = new Map(); // payment_hash → [callbacks] (non persisté)
    this.save();
  }

  save() {
    if (this.store) this.store.save(this.state);
  }

  nodeName(name) {
    if (!this.state.nodes[name]) throw [404, 'UnknownNode', { message: name }];
    return name;
  }

  aliasOf(pubkey) {
    const hit = Object.entries(this.state.nodes).find(([, n]) => n.public_key === pubkey);
    return hit ? hit[0] : null;
  }

  /* ---------- Lecture ---------- */

  nodeInfo(name) {
    const n = this.state.nodes[this.nodeName(name)];
    const chans = this.state.channels.filter((c) => c.a === name || c.b === name);
    return {
      alias: n.alias,
      public_key: n.public_key,
      color: n.color,
      block_height: this.heightFn(),
      active_channels: chans.length,
      peers: chans.length,
      synced: true,
      version: 'simulation (LND_MODE=mock)',
    };
  }

  channels(name) {
    this.nodeName(name);
    return this.state.channels
      .filter((c) => c.a === name || c.b === name)
      .map((c) => {
        const partner = c.a === name ? c.b : c.a;
        return {
          id: c.id,
          partner_alias: partner,
          partner_public_key: this.state.nodes[partner].public_key,
          capacity: c.capacity,
          local_balance: c.bal[name],
          remote_balance: c.bal[partner],
          unsettled_balance: c.pending,
          is_active: true,
          initiator: c.a === name,
        };
      });
  }

  balances(name) {
    const chans = this.channels(name);
    const pendingOut = Object.values(this.state.payments)
      .filter((p) => p.payer === name && p.status === 'IN_FLIGHT')
      .reduce((s, p) => s + p.tokens + p.fee, 0);
    return {
      onchain_sat: this.state.nodes[name].onchain_sat,
      offchain_local_sat: chans.reduce((s, c) => s + c.local_balance, 0),
      offchain_remote_sat: chans.reduce((s, c) => s + c.remote_balance, 0),
      pending_out_sat: pendingOut,
    };
  }

  newAddress(name) {
    this.nodeName(name);
    this.state.addresses += 1;
    this.save();
    return `bcrt1q${bech32ish(crypto.randomBytes(20))}`;
  }

  /* ---------- Factures ---------- */

  createInvoiceRecord(name, { hash, preimage, tokens, memo, expirySec, hold }) {
    if (this.state.invoices[hash]) throw [409, 'InvoiceWithGivenHashAlreadyExists'];
    const request = `lnbcrt${amountHrp(tokens)}1p${bech32ish(Buffer.from(hash, 'hex'))}${bech32ish(crypto.randomBytes(24))}`;
    const inv = {
      id: hash,
      node: name,
      tokens,
      description: memo || '',
      request,
      preimage: preimage || null,
      is_hold: !!hold,
      state: 'OPEN',
      created_at: nowIso(),
      expires_at: new Date(Date.now() + expirySec * 1000).toISOString(),
      settled_at: null,
    };
    this.state.invoices[hash] = inv;
    this.save();
    return inv;
  }

  addInvoice(name, tokens, memo, expirySec = 3600) {
    this.nodeName(name);
    const preimage = crypto.randomBytes(32).toString('hex');
    const inv = this.createInvoiceRecord(name, { hash: sha256(preimage), preimage, tokens, memo, expirySec, hold: false });
    return { id: inv.id, request: inv.request, tokens, secret: preimage };
  }

  addHoldInvoice(name, hash, tokens, memo, expirySec = 1800) {
    this.nodeName(name);
    const inv = this.createInvoiceRecord(name, { hash, tokens, memo, expirySec, hold: true });
    return { id: inv.id, request: inv.request, tokens };
  }

  expireIfNeeded(inv) {
    if (inv.state === 'OPEN' && Date.parse(inv.expires_at) < Date.now()) {
      inv.state = 'CANCELED';
      this.save();
    }
  }

  lookup(name, hash) {
    const inv = this.state.invoices[hash];
    if (!inv || inv.node !== name) throw [404, 'UnknownInvoice', { message: hash }];
    this.expireIfNeeded(inv);
    return {
      id: inv.id,
      state: inv.state,
      tokens: inv.tokens,
      request: inv.request,
      description: inv.description,
      is_held: inv.state === 'ACCEPTED',
      is_confirmed: inv.state === 'SETTLED',
      is_canceled: inv.state === 'CANCELED',
    };
  }

  settle(name, preimage) {
    const hash = sha256(preimage);
    const inv = this.state.invoices[hash];
    if (!inv || inv.node !== name || !inv.is_hold) throw [404, 'SecretDoesNotMatchAnyExistingHodlInvoice'];
    if (inv.state === 'SETTLED') return;
    if (inv.state !== 'ACCEPTED') throw [402, 'CannotSettleHtlcBeforeHtlcReceived'];
    inv.preimage = preimage;
    this.resolve(hash, true);
  }

  cancel(name, hash) {
    const inv = this.state.invoices[hash];
    if (!inv || inv.node !== name) throw [404, 'UnknownInvoice'];
    if (inv.state === 'SETTLED') throw [400, 'InvoiceIsAlreadySettled'];
    if (inv.state === 'CANCELED') return;
    if (inv.state === 'ACCEPTED') this.resolve(hash, false);
    else {
      inv.state = 'CANCELED';
      this.save();
    }
  }

  decode(request) {
    const inv = Object.values(this.state.invoices).find((i) => i.request === String(request || '').trim());
    if (!inv) throw [400, 'FailedToDecodePaymentRequest'];
    return {
      id: inv.id,
      destination: this.state.nodes[inv.node].public_key,
      destination_alias: inv.node,
      tokens: inv.tokens,
      description: inv.description,
      expires_at: inv.expires_at,
      created_at: inv.created_at,
      cltv_delta: 80,
      network: 'regtest',
    };
  }

  /* ---------- Paiements ---------- */

  /** Parcours en largeur sur les canaux dont la liquidité sortante suffit. */
  findRoute(from, to, tokens) {
    const prev = { [from]: null };
    const queue = [from];
    while (queue.length) {
      const u = queue.shift();
      if (u === to) break;
      for (const c of this.state.channels) {
        if (c.a !== u && c.b !== u) continue;
        const v = c.a === u ? c.b : c.a;
        if (v in prev) continue;
        if (c.bal[u] < tokens) continue; // liquidité sortante insuffisante : arête ignorée
        prev[v] = { node: u, chan: c };
        queue.push(v);
      }
    }
    if (!(to in prev)) return null;
    const hops = [];
    for (let v = to; prev[v]; v = prev[v].node) hops.unshift({ from: prev[v].node, to: v, chan: prev[v].chan });
    // Montants exacts : on remonte depuis le destinataire en ajoutant les frais des intermédiaires.
    let amt = tokens;
    let fee = 0;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      hops[i].amount = amt;
      if (i > 0) {
        const f = routingFee(amt);
        hops[i].fee = f;
        fee += f;
        amt += f;
      } else hops[i].fee = 0;
    }
    if (hops.some((h) => h.chan.bal[h.from] < h.amount)) return null;
    return { hops, fee, total: amt };
  }

  startPayment(payer, request) {
    this.nodeName(payer);
    const inv = Object.values(this.state.invoices).find((i) => i.request === String(request || '').trim());
    if (!inv) throw [400, 'FailedToDecodePaymentRequest'];
    this.expireIfNeeded(inv);
    if (inv.node === payer) throw [400, 'CannotPayToSelf (SelfPayment)'];
    if (inv.state === 'SETTLED' || inv.state === 'ACCEPTED') throw [400, 'InvoiceIsAlreadyPaid'];
    if (inv.state === 'CANCELED') {
      throw [400, Date.parse(inv.expires_at) < Date.now() ? 'PaymentRequestExpired' : 'InvoiceIsCanceled'];
    }
    const route = this.findRoute(payer, inv.node, inv.tokens);
    if (!route) throw [503, 'PaymentPathfindingFailedToFindPossibleRoute', { message: 'insufficient liquidity' }];

    // Verrouillage des HTLC sur chaque canal du chemin.
    for (const h of route.hops) {
      h.chan.bal[h.from] -= h.amount;
      h.chan.pending += h.amount;
    }
    this.state.payments[inv.id] = {
      id: inv.id,
      payer,
      destination: inv.node,
      tokens: inv.tokens,
      fee: route.fee,
      route: [payer, ...route.hops.map((h) => h.to)],
      htlcs: route.hops.map((h) => ({ chan: h.chan.id, from: h.from, to: h.to, amount: h.amount, fee: h.fee })),
      status: 'IN_FLIGHT',
      preimage: null,
      created_at: nowIso(),
      description: inv.description,
    };
    inv.state = 'ACCEPTED';
    this.save();
    if (!inv.is_hold) this.resolve(inv.id, true);
    return this.state.payments[inv.id];
  }

  /** Règle (success=true) ou annule tous les HTLC d'un paiement. */
  resolve(hash, success) {
    const inv = this.state.invoices[hash];
    const pay = this.state.payments[hash];
    if (pay && pay.status === 'IN_FLIGHT') {
      for (const h of pay.htlcs) {
        const c = this.state.channels.find((x) => x.id === h.chan);
        c.pending -= h.amount;
        c.bal[success ? h.to : h.from] += h.amount;
      }
      pay.status = success ? 'SUCCEEDED' : 'FAILED';
      pay.preimage = success ? inv.preimage : null;
      pay.resolved_at = nowIso();
    }
    inv.state = success ? 'SETTLED' : 'CANCELED';
    if (success) inv.settled_at = nowIso();
    this.save();
    const cbs = this.waiters.get(hash) || [];
    this.waiters.delete(hash);
    for (const cb of cbs) {
      if (success) cb(null, this.paymentResult(pay));
      else cb([503, 'PaymentRejectedByDestination (InvoiceIsCanceled)']);
    }
  }

  paymentResult(pay) {
    return {
      id: pay.id,
      secret: pay.preimage,
      tokens: pay.tokens,
      fee: pay.fee,
      route: pay.route,
      hops: pay.htlcs.map((h) => ({ channel: h.chan, alias: h.to, public_key: this.state.nodes[h.to].public_key, forward: h.amount, fee: h.fee })),
    };
  }

  payAsync(payer, request, cb = () => {}) {
    let pay;
    try {
      pay = this.startPayment(payer, request);
    } catch (e) {
      setImmediate(() => cb(e));
      return;
    }
    if (pay.status === 'SUCCEEDED') setImmediate(() => cb(null, this.paymentResult(pay)));
    else {
      const list = this.waiters.get(pay.id) || [];
      list.push(cb);
      this.waiters.set(pay.id, list);
    }
  }

  paySync(payer, request) {
    return new Promise((resolve, reject) => this.payAsync(payer, request, (err, res) => (err ? reject(err) : resolve(res))));
  }

  history(name) {
    this.nodeName(name);
    const invoices = Object.values(this.state.invoices)
      .filter((i) => i.node === name)
      .map((i) => {
        this.expireIfNeeded(i);
        return { id: i.id, tokens: i.tokens, description: i.description, state: i.state, is_hold: i.is_hold, created_at: i.created_at, request: i.request };
      });
    const payments = Object.values(this.state.payments)
      .filter((p) => p.payer === name)
      .map((p) => ({ id: p.id, tokens: p.tokens, fee: p.fee, status: p.status, route: p.route, description: p.description, created_at: p.created_at, secret: p.preimage }));
    const byDate = (a, b) => (a.created_at < b.created_at ? 1 : -1);
    return { invoices: invoices.sort(byDate).slice(0, 30), payments: payments.sort(byDate).slice(0, 30) };
  }
}

/** Façade d'un nœud : même interface que lightning/real.js. */
function mockNode(network, name, role) {
  return {
    id: name,
    role,
    mode: 'mock',
    nodeInfo: async () => network.nodeInfo(name),
    balances: async () => network.balances(name),
    channels: async () => network.channels(name),
    newAddress: async () => network.newAddress(name),
    addInvoice: async (sats, memo) => network.addInvoice(name, sats, memo),
    addHoldInvoice: async (hash, sats, memo, expirySec) => network.addHoldInvoice(name, hash, sats, memo, expirySec),
    lookup: async (hash) => network.lookup(name, hash),
    settle: async (preimage) => network.settle(name, preimage),
    cancel: async (hash) => network.cancel(name, hash),
    decode: async (bolt11) => network.decode(bolt11),
    paySync: (bolt11) => network.paySync(name, bolt11),
    payAsync: (bolt11, cb) => network.payAsync(name, bolt11, cb),
    history: async () => network.history(name),
    health: async () => ({ reachable: true }),
  };
}

module.exports = { MockNetwork, mockNode, STORE_KEY };
