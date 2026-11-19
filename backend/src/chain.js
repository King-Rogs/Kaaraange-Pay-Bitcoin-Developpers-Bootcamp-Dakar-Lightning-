'use strict';
/**
 * Portefeuille Bitcoin (un portefeuille regtest par utilisateur), explorateur
 * de blocs et console Lightning (alice, bob, carol).
 * Contient aussi les routes héritées de la passerelle connect-lnd
 * (/api/nodes…), protégées par API_KEY si elle est définie.
 */
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const bitcoin = require('./bitcoin');
const ln = require('./lightning');
const v = require('./util');
const db = require('./db');
const { requireAuth } = require('./auth');
const { fail } = v;

const walletName = (user) => `kp_u${user.id}`;
/** Attend une promesse au plus `ms` millisecondes (le minuteur est toujours nettoyé). */
function withTimeout(promise, ms, msg) {
  let timer;
  const t = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new v.HttpError(504, msg)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

const router = express.Router();

/* ---------- Portefeuille ---------- */

router.use(['/wallet', '/btc', '/ln'], requireAuth);

router.get('/wallet', async (req, res) => {
  const name = walletName(req.user);
  const c = bitcoin.chain;
  const exists = await c.walletExists(name);
  const chain = await c.chainInfo();
  res.json({ name, exists, mode: config.btcMode, chain, ...(exists ? await c.walletInfo(name) : {}) });
});

router.post('/wallet/create', async (req, res) => {
  const name = walletName(req.user);
  await bitcoin.chain.createWallet(name);
  db.audit(req.user.id, 'portefeuille.creation', `wallet:${name}`, null, req.ip);
  res.status(201).json({ name, exists: true });
});

router.post('/wallet/address', async (req, res) => {
  res.json({ address: await bitcoin.chain.newAddress(walletName(req.user)) });
});

router.post('/wallet/mine', async (req, res) => {
  const n = v.intIn((req.body || {}).blocks, { field: 'blocks', label: 'Le nombre de blocs', min: 1, max: 200 });
  const r = await bitcoin.chain.mine(walletName(req.user), n);
  res.json({ mined: r.hashes.length, address: r.address, hashes: r.hashes.slice(-3), height: await bitcoin.chain.height() });
});

router.post('/wallet/send', async (req, res) => {
  const b = req.body || {};
  const address = String(b.address || '').trim();
  if (!bitcoin.ADDRESS_RE.test(address)) fail(400, 'Adresse Bitcoin invalide (bcrt1… attendu en regtest).', 'address');
  const amount = v.intIn(b.amount_sat, { field: 'amount', label: 'Le montant (en sats)', min: 546, max: 21e6 * 1e8 });
  const r = await bitcoin.chain.send(walletName(req.user), address, amount);
  db.audit(req.user.id, 'portefeuille.envoi', `tx:${r.txid}`, { amount_sat: amount }, req.ip);
  res.json(r);
});

/* ---------- Explorateur ---------- */

router.get('/btc/chain', async (_req, res) => res.json(await bitcoin.chain.chainInfo()));
router.get('/btc/blocks', async (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
  res.json({ blocks: await bitcoin.chain.blocks(limit) });
});
router.get('/btc/block/:ref', async (req, res) => {
  const ref = String(req.params.ref);
  if (!/^\d{1,9}$/.test(ref) && !/^[0-9a-f]{64}$/i.test(ref)) fail(400, 'Indiquez une hauteur ou un hash de bloc.', 'ref');
  res.json({ block: await bitcoin.chain.block(ref) });
});

/* ---------- Console Lightning ---------- */

function nodeOr404(ref) {
  const n = ln.find(String(ref));
  if (!n) fail(404, `Nœud inconnu « ${ref} ». Nœuds disponibles : ${ln.all.map((x) => x.id).join(', ')}.`);
  return n;
}

async function nodeSnapshot(n) {
  try {
    const [info, balances, channels] = await Promise.all([n.nodeInfo(), n.balances(), n.channels()]);
    return { id: n.id, role: n.role, mode: n.mode, reachable: true, info, balances, channels };
  } catch (e) {
    return { id: n.id, role: n.role, mode: n.mode, reachable: false, error: v.lnError(e).message };
  }
}

router.get('/ln/nodes', async (_req, res) => {
  res.json({ mode: config.lndMode, nodes: await Promise.all(ln.all.map(nodeSnapshot)) });
});

router.post('/ln/decode', async (req, res) => {
  const request = String((req.body || {}).request || '').trim();
  if (!request) fail(400, 'Collez une facture BOLT11.', 'request');
  res.json({ decoded: await ln.call(ln.acheteur.decode(request)) });
});

router.get('/ln/:node/history', async (req, res) => {
  const n = nodeOr404(req.params.node);
  res.json({ node: n.id, ...(await ln.call(n.history())) });
});

router.post('/ln/:node/invoice', async (req, res) => {
  const n = nodeOr404(req.params.node);
  const b = req.body || {};
  const sats = v.intIn(b.amount_sat, { field: 'amount', label: 'Le montant (en sats)', min: 1, max: 1_000_000 });
  const memo = v.text(b.memo, { field: 'memo', label: 'La description', max: 120 });
  const inv = await ln.call(n.addInvoice(sats, memo));
  db.audit(req.user.id, 'ln.facture_console', `node:${n.id}`, { sats }, req.ip);
  res.status(201).json({ node: n.id, id: inv.id, request: inv.request, tokens: inv.tokens });
});

router.post('/ln/:node/pay', async (req, res) => {
  const n = nodeOr404(req.params.node);
  const request = String((req.body || {}).request || '').trim();
  if (!request) fail(400, 'Collez une facture BOLT11.', 'request');
  const r = await withTimeout(
    ln.call(() => n.paySync(request)),
    30000,
    'Paiement toujours en vol après 30 s : c’est sans doute une hold invoice, réglée seulement au settle.',
  );
  db.audit(req.user.id, 'ln.paiement_console', `node:${n.id}`, { sats: r.tokens, route: r.route }, req.ip);
  res.json({ node: n.id, id: r.id, preimage: r.secret, tokens: r.tokens, fee: r.fee, route: r.route, hops: r.hops });
});

/* ---------- Passerelle connect-lnd (compatibilité) ---------- */

const gateway = express.Router();

function safeEqual(a, b) {
  const l = Buffer.from(String(a));
  const r = Buffer.from(String(b));
  return l.length === r.length && crypto.timingSafeEqual(l, r);
}

// Clé API optionnelle, comme connect-lnd : x-api-key ou Authorization: Bearer.
gateway.use((req, _res, next) => {
  if (!config.apiKey) return next();
  const provided = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!provided || !safeEqual(provided, config.apiKey)) fail(401, 'Clé API absente ou invalide.');
  return next();
});

gateway.get('/', (_req, res) => {
  res.json({ maxNodes: 3, connectedNodes: ln.all.map((n) => ({ id: n.id, role: n.role, grpcHost: n.socket || 'simulation' })) });
});
gateway.get('/:nodeId/getinfo', async (req, res) => res.json({ ...(await ln.call(nodeOr404(req.params.nodeId).nodeInfo())), nodeId: req.params.nodeId }));
gateway.get('/:nodeId/balance', async (req, res) => res.json({ nodeId: req.params.nodeId, ...(await ln.call(nodeOr404(req.params.nodeId).balances())) }));
gateway.get('/:nodeId/channels', async (req, res) => {
  const channels = await ln.call(nodeOr404(req.params.nodeId).channels());
  res.json({ nodeId: req.params.nodeId, count: channels.length, channels });
});

module.exports = { router, gateway, nodeSnapshot, walletName };
