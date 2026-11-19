'use strict';
/**
 * Nœud LND réel via ln-service (gRPC), comme la passerelle connect-lnd :
 * hôte gRPC + macaroon en base64 + certificat TLS en base64.
 *
 * connect-lnd n'expose pas les hold invoices ; ln-service les gère nativement :
 * createHodlInvoice, settleHodlInvoice, cancelHodlInvoice et getInvoice
 * (is_held / is_confirmed / is_canceled).
 */
const ln = require('ln-service');

const toState = (inv) => (inv.is_confirmed ? 'SETTLED' : inv.is_canceled ? 'CANCELED' : inv.is_held ? 'ACCEPTED' : 'OPEN');

function realNode(cfg) {
  const { lnd } = ln.authenticatedLndGrpc({ socket: cfg.socket, macaroon: cfg.macaroon, cert: cfg.cert });
  const aliasCache = new Map();

  async function aliasOf(publicKey) {
    if (!publicKey) return null;
    if (aliasCache.has(publicKey)) return aliasCache.get(publicKey);
    try {
      const { alias } = await ln.getNode({ lnd, public_key: publicKey, is_omitting_channels: true });
      aliasCache.set(publicKey, alias || null);
      return alias || null;
    } catch {
      return null;
    }
  }

  const node = {
    id: cfg.id,
    role: cfg.role,
    mode: 'lnd',
    socket: cfg.socket,

    async nodeInfo() {
      const w = await ln.getWalletInfo({ lnd });
      aliasCache.set(w.public_key, w.alias);
      return {
        alias: w.alias,
        public_key: w.public_key,
        color: w.color,
        block_height: w.current_block_height,
        active_channels: w.active_channels_count,
        peers: w.peers_count,
        synced: w.is_synced_to_chain,
        version: w.version,
      };
    },

    async balances() {
      const [chain, chans, pending] = await Promise.all([
        ln.getChainBalance({ lnd }),
        ln.getChannels({ lnd }),
        ln.getPayments({ lnd, limit: 50 }).catch(() => ({ payments: [] })),
      ]);
      const inFlight = (pending.payments || []).filter((p) => p.is_pending).reduce((s, p) => s + p.tokens + (p.fee || 0), 0);
      return {
        onchain_sat: chain.chain_balance,
        offchain_local_sat: chans.channels.reduce((s, c) => s + c.local_balance, 0),
        offchain_remote_sat: chans.channels.reduce((s, c) => s + c.remote_balance, 0),
        pending_out_sat: inFlight,
      };
    },

    async channels() {
      const { channels } = await ln.getChannels({ lnd });
      return Promise.all(
        channels.map(async (c) => ({
          id: c.id,
          partner_alias: (await aliasOf(c.partner_public_key)) || c.partner_public_key.slice(0, 12),
          partner_public_key: c.partner_public_key,
          capacity: c.capacity,
          local_balance: c.local_balance,
          remote_balance: c.remote_balance,
          unsettled_balance: c.unsettled_balance,
          is_active: c.is_active,
          initiator: !c.is_partner_initiated,
        })),
      );
    },

    async newAddress() {
      const { address } = await ln.createChainAddress({ lnd, format: 'p2wpkh' });
      return address;
    },

    async addInvoice(sats, memo) {
      const inv = await ln.createInvoice({ lnd, tokens: sats, description: memo || '' });
      return { id: inv.id, request: inv.request, tokens: inv.tokens, secret: inv.secret };
    },

    async addHoldInvoice(hash, sats, memo, expirySec = 1800) {
      const inv = await ln.createHodlInvoice({
        lnd,
        id: hash,
        tokens: sats,
        description: memo || '',
        expires_at: new Date(Date.now() + expirySec * 1000).toISOString(),
      });
      return { id: inv.id || hash, request: inv.request, tokens: sats };
    },

    async lookup(hash) {
      const inv = await ln.getInvoice({ lnd, id: hash });
      return {
        id: inv.id,
        state: toState(inv),
        tokens: inv.tokens,
        request: inv.request,
        description: inv.description,
        is_held: !!inv.is_held,
        is_confirmed: !!inv.is_confirmed,
        is_canceled: !!inv.is_canceled,
      };
    },

    async settle(preimage) {
      await ln.settleHodlInvoice({ lnd, secret: preimage });
    },

    async cancel(hash) {
      await ln.cancelHodlInvoice({ lnd, id: hash });
    },

    async decode(bolt11) {
      const d = await ln.decodePaymentRequest({ lnd, request: String(bolt11 || '').trim() });
      return {
        id: d.id,
        destination: d.destination,
        destination_alias: await aliasOf(d.destination),
        tokens: d.tokens,
        description: d.description,
        expires_at: d.expires_at,
        created_at: d.created_at,
        cltv_delta: d.cltv_delta,
        network: d.network,
      };
    },

    async paySync(bolt11) {
      const own = await ln.getWalletInfo({ lnd });
      const r = await ln.pay({ lnd, request: String(bolt11 || '').trim() });
      const hops = await Promise.all(
        (r.hops || []).map(async (h) => ({ channel: h.channel, public_key: h.public_key, alias: (await aliasOf(h.public_key)) || h.public_key.slice(0, 12), forward: h.forward, fee: h.fee })),
      );
      return { id: r.id, secret: r.secret, tokens: r.tokens, fee: r.fee, route: [own.alias, ...hops.map((h) => h.alias)], hops };
    },

    /**
     * Paiement non attendu : une hold invoice reste « en vol » jusqu'au
     * settle ou au cancel. Le rappel reçoit l'erreur éventuelle (ignorée par
     * l'appelant quand la facture a été annulée volontairement).
     */
    payAsync(bolt11, cb = () => {}) {
      ln.pay({ lnd, request: String(bolt11 || '').trim() }).then(
        (r) => cb(null, r),
        (e) => cb(e),
      );
    },

    async history() {
      const [inv, pay] = await Promise.all([ln.getInvoices({ lnd, limit: 30 }), ln.getPayments({ lnd, limit: 30 })]);
      return {
        invoices: inv.invoices.map((i) => ({
          id: i.id,
          tokens: i.tokens,
          description: i.description,
          state: toState(i),
          is_hold: false,
          created_at: i.created_at,
          request: i.request,
        })),
        payments: pay.payments.map((p) => ({
          id: p.id,
          tokens: p.tokens,
          fee: p.fee,
          status: p.is_confirmed ? 'SUCCEEDED' : p.is_pending ? 'IN_FLIGHT' : 'FAILED',
          route: (p.hops || []).slice(),
          description: '',
          created_at: p.created_at,
          secret: p.secret,
        })),
      };
    },

    async health() {
      try {
        await ln.getWalletInfo({ lnd });
        return { reachable: true };
      } catch (e) {
        return { reachable: false, error: Array.isArray(e) ? e[1] : e.message };
      }
    },
  };
  return node;
}

module.exports = { realNode };
