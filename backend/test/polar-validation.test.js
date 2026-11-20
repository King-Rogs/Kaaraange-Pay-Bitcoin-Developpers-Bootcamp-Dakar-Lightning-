'use strict';
/** Validation backend explicite : vrais LND/Core regtest, SQLite isolée et
 * processus séparé. Les seuls conteneurs interrompus sont identifiés par leur
 * clé publique avant l’essai. Aucun canal ni réseau n’est supprimé. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaraange-polar-final-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'validation.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), SIMULATION: 'false', SEED_DEMO: 'true', PRICE_MODE: 'fixed', BTC_XOF_FALLBACK: '60000000', ADMIN_EMAIL: 'admin@polar-validation.test', OFFER_SECONDS: '120', RECOVERY_RETRY_SEC: '0', LND_RPC_TIMEOUT_MS: '1500', LND_PAYMENT_TIMEOUT_MS: '6000', LND_PATHFINDING_MS: '2000', COOKIE_SECURE: 'false', DEV_MODE: 'true' });
const config = require('../src/config');
const db = require('../src/db');
const ln = require('../src/lightning');
const bitcoin = require('../src/bitcoin');
const { now } = require('../src/util');
const { hashPassword } = require('../src/auth');
const containers = { acheteur: 'polar-n5-fatou', vendeur: 'polar-n5-awa', livreur: 'polar-n5-moussa' };
const paused = new Set(), invoices = [], checks = [];
const reportDir = path.join(config.root, 'data', 'backend-validation');
fs.mkdirSync(reportDir, { recursive: true });
let worker, base, serial = 0, dbOpened = false, blocker, refundGate = false;
const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const workerLog = fs.openSync(path.join(reportDir, 'worker.log'), 'a');
async function until(fn, label, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { const r = await fn(); if (r) return r; await sleep(200); } throw new Error(`Délai dépassé : ${label}`); }
async function check(name, fn) { const start = Date.now(); await fn(); checks.push({ name, passed: true, duration_ms: Date.now() - start }); console.log(`OK Polar ${checks.length} : ${name}`); save(); }
function save(extra = {}) { fs.writeFileSync(path.join(reportDir, 'polar-resultats.json'), JSON.stringify({ completed: false, mode: 'LND et Bitcoin Core regtest réels', checks, database: config.dbPath, date: new Date().toISOString(), ...extra }, null, 2)); }
async function docker(...args) { return (await exec('docker', args, { timeout: 20000, maxBuffer: 1024 * 1024 })).stdout; }
async function pause(role) { const name = containers[role]; await docker('pause', name); paused.add(name); }
async function resume(role) { const name = containers[role]; if (paused.has(name)) { await docker('unpause', name); paused.delete(name); } await until(async () => { try { return (await ln.get(role).health()).reachable; } catch { return false; } }, `reprise du nœud ${role}`); }
async function cli(role, command) { return JSON.parse(await docker('exec', containers[role], 'lncli', '--lnddir=/home/lnd/.lnd', '--network=regtest', command)); }
async function startWorker() {
  worker = fork(path.join(__dirname, 'polar-worker.cjs'), [], { env: { ...process.env }, execArgv: ['--experimental-sqlite', '--no-warnings=ExperimentalWarning'], stdio: ['ignore', workerLog, workerLog, 'ipc'] });
  worker.on('message', m => { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m); } });
  worker.on('exit', code => { for (const p of pending.values()) p.reject(new Error(`Processus arrêté (${code})`)); pending.clear(); });
  const ready = await event('ready'); base = `http://127.0.0.1:${ready.port}`;
}
function event(name) { const current = worker; return new Promise((resolve, reject) => { const timer = setTimeout(() => { current.off('message', listener); reject(new Error(`Événement ${name} absent`)); }, 20000); function listener(m) { if (m.event === name) { clearTimeout(timer); current.off('message', listener); resolve(m); } } current.on('message', listener); }); }
function command(action) { return new Promise((resolve, reject) => { const id = ++serial; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Commande ${action} trop longue`)); }, 45000); pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } }); worker.send({ id, action }); }); }
async function stopWorker() { if (worker && worker.exitCode === null) { const exited = new Promise(resolve => worker.once('exit', resolve)); worker.send({ action: 'stop' }); await exited; } }
class Client {
  async req(method, url, body, expected = 200) {
    const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: this.cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    for (const c of response.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const data = await response.json(); if (expected !== null) assert.equal(response.status, expected, `${method} ${url}: ${data.error || response.status}`);
    return { ...data, statusCode: response.status };
  }
  get(url, expected) { return this.req('GET', url, undefined, expected); }
  post(url, body = {}, expected) { return this.req('POST', url, body, expected); }
  login(name) { return this.post('/api/auth/login', { email: `${name}@demo.kaaraange.sn`, password: 'demo1234' }); }
}
const buyer = new Client(), seller = new Client(), courier = new Client(), admin = new Client(), courier2 = new Client();
let article, shop, courierId, otherId;
async function order(pay = true) {
  const secret = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex');
  let { order: o } = await buyer.post('/api/orders', { article_id: article.id, item_hash: hash, lat: shop.lat + 0.005, lng: shop.lng, address: 'Validation backend Polar isolée' }, 201);
  invoices.push([ln.vendeur, o.invoices.item.hash], [ln.livreur, o.invoices.fee.hash]);
  if (pay) ({ order: o } = await buyer.post(`/api/orders/${o.id}/pay`));
  return { order: o, secret };
}
async function ride(pickup = true) {
  if (otherId) await courier2.post('/api/courier/status', { status: 'offline' });
  await courier.post('/api/courier/status', { status: 'available', mode: 'sim', lat: shop.lat, lng: shop.lng });
  const result = await order(); await command('tick');
  const { offer } = await courier.get('/api/courier/me'); assert.ok(offer, 'Moussa doit recevoir l’offre');
  await courier.post(`/api/courier/offers/${offer.id}/accept`);
  if (pickup) await courier.post(`/api/orders/${result.order.id}/pickup`);
  return result;
}
async function state(o, item, fee) { assert.equal((await ln.vendeur.lookup(o.invoices.item.hash)).state, item); assert.equal((await ln.livreur.lookup(o.invoices.fee.hash)).state, fee); }
async function resolved(o, expected) { await until(async () => { const h = (await ln.acheteur.history()).payments; return [o.invoices.item.hash, o.invoices.fee.hash].every((hash, i) => h.some(p => p.id === hash && p.status === expected[i])); }, 'résolution des HTLC chez Fatou'); }
async function reimbursed(o) {
  await until(async () => { db.update('orders', o.id, { fee_refund_attempt_at: now() - 31 }); await command('tick'); return db.one('SELECT fee_refunded_at FROM orders WHERE id = ?', o.id).fee_refunded_at; }, 'remboursement Awa vers Fatou', 45000);
  const row = db.one('SELECT * FROM orders WHERE id = ?', o.id); assert.equal((await ln.acheteur.lookup(row.fee_refund_hash)).state, 'SETTLED');
  const payment = (await ln.vendeur.history()).payments.find(p => p.id === row.fee_refund_hash); assert.equal(payment?.status, 'SUCCEEDED'); assert.equal(payment.tokens, o.fee_sat);
  const original = row.fee_refund_hash; await command('tick'); assert.equal(db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash, original);
}
async function main() {
  assert.equal(config.lndMode, 'lnd'); assert.equal(config.btcMode, 'rpc');
  db.open(config.dbPath); dbOpened = true; bitcoin.init(); ln.init();
  await check('préflight : regtest, bons conteneurs, trois nœuds synchronisés et aucun HTLC préexistant', async () => {
    assert.equal((await bitcoin.chain.chainInfo()).chain, 'regtest');
    for (const role of ['acheteur', 'vendeur', 'livreur']) { const info = await ln.get(role).nodeInfo(); const native = await cli(role, 'getinfo'); assert.equal(native.identity_pubkey, info.public_key); assert.equal(native.synced_to_chain, true); const channels = await ln.get(role).channels(); assert.ok(channels.every(c => c.is_active)); assert.ok(channels.every(c => !c.unsettled_balance), 'Terminer les paiements existants avant cet essai'); }
  });
  await startWorker();
  await Promise.all([buyer.login('fatou'), seller.login('awa'), courier.login('moussa')]);
  article = (await buyer.get('/api/articles')).articles.find(a => /Robe/.test(a.title)); assert.ok(article); shop = article.seller.shop;
  courierId = (await courier.get('/api/auth/me')).user.id;
  await admin.post('/api/auth/register', { name: 'Admin validation Polar', email: 'admin@polar-validation.test', password: 'Validation1234!' }, 201);
  await check('livraison : CLTV explicite, deux holds réels, faux code refusé puis A+B réglées', async () => {
    const r = await ride(); const o = r.order; await state(o, 'ACCEPTED', 'ACCEPTED');
    assert.ok((await ln.acheteur.balances()).pending_out_sat >= o.total_sat);
    assert.ok((await ln.acheteur.decode(o.invoices.item.request)).cltv_delta >= config.holdCltvDelta);
    await buyer.post(`/api/orders/${o.id}/deliver`, { code: '0'.repeat(64) }, 400); await state(o, 'ACCEPTED', 'ACCEPTED');
    await buyer.post(`/api/orders/${o.id}/deliver`, { code: r.secret }); await state(o, 'SETTLED', 'SETTLED'); await resolved(o, ['SUCCEEDED', 'SUCCEEDED']);
  });
  for (const reason of ['non_conforme', 'endommage', 'change_avis', 'autre']) await check(`refus ${reason} : retour, livreur payé et livraison remboursée par Awa`, async () => {
    const { order: o } = await ride(); await buyer.post(`/api/orders/${o.id}/refuse`, { reason }); await state(o, 'CANCELED', 'ACCEPTED');
    await seller.post(`/api/orders/${o.id}/confirm-return`); await reimbursed(o); await state(o, 'CANCELED', 'SETTLED'); await resolved(o, ['FAILED', 'SUCCEEDED']);
  });
  await check('client absent : proximité obligatoire, retour payé sans remboursement vendeur', async () => {
    const { order: o } = await ride(); await courier.post('/api/courier/location', { lat: shop.lat - 0.1, lng: shop.lng }); await courier.post(`/api/orders/${o.id}/absent`, {}, 400);
    await courier.post('/api/courier/location', o.delivery); await courier.post(`/api/orders/${o.id}/absent`); await seller.post(`/api/orders/${o.id}/confirm-return`);
    assert.equal(db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash, null); await state(o, 'CANCELED', 'SETTLED'); await resolved(o, ['FAILED', 'SUCCEEDED']);
  });
  await check('remboursement volontaire vendeur avant retrait : A+B annulées', async () => { const { order: o } = await ride(false); await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Rupture de stock vérifiée' }); await state(o, 'CANCELED', 'CANCELED'); await resolved(o, ['FAILED', 'FAILED']); });
  await check('retour demandé par vendeur après retrait : livraison à sa charge', async () => { const { order: o } = await ride(); await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Erreur de préparation constatée' }); await seller.post(`/api/orders/${o.id}/confirm-return`); await reimbursed(o); await resolved(o, ['FAILED', 'SUCCEEDED']); });
  await check('aucun livreur : échéance puis remboursement intégral', async () => { await courier.post('/api/courier/status', { status: 'offline' }); const { order: o } = await order(); db.update('orders', o.id, { deadline_at: now() - 1 }); await command('tick'); await state(o, 'CANCELED', 'CANCELED'); await resolved(o, ['FAILED', 'FAILED']); });
  await check('non-présentation : annulation et pénalité opérationnelle unique', async () => { const { order: o } = await ride(false); db.update('orders', o.id, { deadline_at: now() - 1 }); await command('tick'); await command('tick'); assert.equal(db.one("SELECT COUNT(*) n FROM courier_incidents WHERE order_id = ? AND kind = 'no_show'", o.id).n, 1); await state(o, 'CANCELED', 'CANCELED'); await resolved(o, ['FAILED', 'FAILED']); });
  await check('abandon avant retrait : autre livreur affecté sans réémettre les paiements', async () => {
    const other = await courier2.post('/api/auth/register', { name: 'Second livreur Polar', email: 'second@polar-validation.test', password: 'Validation1234!' }, 201); otherId = other.user.id;
    const { order: o } = await ride(false); await courier.post(`/api/orders/${o.id}/abandon`, { reason: 'Indisponibilité avant retrait' });
    await courier2.post('/api/courier/status', { status: 'available', mode: 'sim', lat: shop.lat, lng: shop.lng }); await command('tick');
    const { offer } = await courier2.get('/api/courier/me'); assert.equal(offer.order_id, o.id); await courier2.post(`/api/courier/offers/${offer.id}/accept`); await state(o, 'ACCEPTED', 'ACCEPTED');
    await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Clôture de la vérification de réattribution' }); await resolved(o, ['FAILED', 'FAILED']);
  });
  await check('abandon après retrait : article annulé, retour obligatoire puis livreur payé', async () => { const { order: o } = await ride(); await courier.post(`/api/orders/${o.id}/abandon`, { reason: 'Incident après retrait du colis' }); await state(o, 'CANCELED', 'ACCEPTED'); await seller.post(`/api/orders/${o.id}/confirm-return`); await state(o, 'CANCELED', 'SETTLED'); await resolved(o, ['FAILED', 'SUCCEEDED']); });
  await check('retour en retard : alerte admin, motif obligatoire et arbitrage payé', async () => {
    const { order: o } = await ride(); await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' }); db.update('orders', o.id, { return_deadline_at: now() - 1 }); await command('tick');
    assert.ok((await admin.get('/api/admin/alerts')).alerts.some(a => a.type === 'return_overdue' && a.order_id === o.id)); await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay' }, 400);
    const reason = 'Retour physique vérifié pendant validation Polar'; await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay', reason });
    assert.equal(JSON.parse(db.one("SELECT details FROM audit WHERE target = ? AND action = 'admin.frais_payes_livreur'", `order:${o.id}`).details).reason, reason); await reimbursed(o); await resolved(o, ['FAILED', 'SUCCEEDED']);
  });
  await check('arbitrage d’annulation des frais : motif conservé, aucun paiement livreur', async () => { const { order: o } = await ride(); await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' }); await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'cancel', reason: 'Course contestée, annulation après vérification' }); await state(o, 'CANCELED', 'CANCELED'); await resolved(o, ['FAILED', 'FAILED']); });
  await check('factures jamais payées : expiration et annulation des deux OPEN', async () => { const { order: o } = await order(false); db.update('orders', o.id, { invoice_expires_at: now() - 10 }); await command('tick'); await state(o, 'CANCELED', 'CANCELED'); });
  await check('nœud Awa figé : santé dégradée, annulation en attente puis reprise confirmée', async () => {
    const { order: o } = await ride(false); await pause('vendeur');
    try { const r = await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Annulation pendant indisponibilité de Awa' }, 202); assert.equal(r.order.status, 'cancel_pending'); const h = await buyer.get('/api/health', 503); assert.equal(h.status, 'degrade'); }
    finally { await resume('vendeur'); }
    await command('tick'); await state(o, 'CANCELED', 'CANCELED'); await resolved(o, ['FAILED', 'FAILED']);
  });
  await check('nœud Moussa figé entre A et B : article réglé, livraison en attente puis reprise', async () => {
    const r = await ride(); await pause('livreur');
    try { const d = await buyer.post(`/api/orders/${r.order.id}/deliver`, { code: r.secret }, 202); assert.equal(d.order.status, 'delivery_pending'); assert.equal((await ln.vendeur.lookup(r.order.invoices.item.hash)).state, 'SETTLED'); }
    finally { await resume('livreur'); }
    await command('tick'); await state(r.order, 'SETTLED', 'SETTLED'); await resolved(r.order, ['SUCCEEDED', 'SUCCEEDED']);
  });
  await check('arrêt brutal du processus entre A et B : reprise par un nouveau processus', async () => {
    const r = await ride(); await command('crash-before-fee'); const old = worker; const exited = new Promise(resolve => old.once('exit', resolve));
    await assert.rejects(buyer.post(`/api/orders/${r.order.id}/deliver`, { code: r.secret })); assert.equal(await exited, 91);
    await state(r.order, 'SETTLED', 'ACCEPTED'); assert.ok(db.one('SELECT * FROM order_actions WHERE order_id = ?', r.order.id));
    await startWorker(); await command('tick'); await state(r.order, 'SETTLED', 'SETTLED'); assert.equal(db.one('SELECT * FROM order_actions WHERE order_id = ?', r.order.id), null); await resolved(r.order, ['SUCCEEDED', 'SUCCEEDED']);
  });
  await check('Awa indisponible pendant remboursement : facture persistée et reprise sans double débit', async () => {
    const { order: o } = await ride(); await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' }); await command('gate-refund'); refundGate = true; const waiting = event('refund-gated'); const returned = seller.post(`/api/orders/${o.id}/confirm-return`); await waiting;
    try { await pause('vendeur'); await command('release-refund'); refundGate = false; const r = await returned; assert.equal(r.order.fee_refund_status, 'pending'); }
    finally { await resume('vendeur'); }
    const hash = db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash; assert.ok(hash); await reimbursed(o); assert.equal(db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash, hash); await resolved(o, ['FAILED', 'SUCCEEDED']);
  });
  await check('liquidité Awa insuffisante réelle : remboursement en attente puis succès après déblocage', async () => {
    const { order: o } = await ride(); await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' }); await command('gate-refund'); refundGate = true; const waiting = event('refund-gated'); const returned = seller.post(`/api/orders/${o.id}/confirm-return`); await waiting;
    try {
      const pub = (await ln.acheteur.nodeInfo()).public_key; const c = (await cli('vendeur', 'listchannels')).channels.find(c => c.remote_pubkey === pub); assert.ok(c && !c.initiator);
      const reserve = Number(c.local_constraints.chan_reserve_sat), amount = Number(c.local_balance) - reserve - 100; assert.ok(amount > o.fee_sat);
      const secret = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex');
      const invoice = await ln.acheteur.addHoldInvoice(hash, amount, 'Validation : réserve temporaire de liquidité vendeur', 300); blocker = hash; invoices.push([ln.acheteur, hash]);
      let payError; ln.vendeur.payAsync(invoice.request, error => { payError = error; });
      await until(async () => { if (payError) throw new Error('Impossible de réserver la liquidité pour l’essai'); return (await ln.acheteur.lookup(hash)).state === 'ACCEPTED'; }, 'blocage de la liquidité vendeur');
      await command('release-refund'); refundGate = false; const r = await returned; assert.equal(r.order.fee_refund_status, 'pending'); const refundHash = db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash; assert.ok(refundHash); assert.equal((await ln.acheteur.lookup(refundHash)).state, 'OPEN');
      await ln.acheteur.cancel(blocker); blocker = null; await until(async () => !(await ln.vendeur.history()).payments.some(p => p.id === hash && p.status === 'IN_FLIGHT'), 'libération de la liquidité');
      await reimbursed(o); assert.equal(db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', o.id).fee_refund_hash, refundHash); await resolved(o, ['FAILED', 'SUCCEEDED']);
    } finally { if (refundGate) { await command('release-refund'); refundGate = false; } if (blocker) { await ln.acheteur.cancel(blocker); blocker = null; } }
  });
  await check('double paiement et réception/refus concurrents : un seul résultat financier', async () => {
    const r = await ride(); const replies = await Promise.all([buyer.post(`/api/orders/${r.order.id}/deliver`, { code: r.secret }, null), buyer.post(`/api/orders/${r.order.id}/refuse`, { reason: 'autre' }, null)]); assert.deepEqual(replies.map(r => r.statusCode).sort(), [200, 409]);
    let current = db.one('SELECT status FROM orders WHERE id = ?', r.order.id); if (current.status === 'returning') { await seller.post(`/api/orders/${r.order.id}/confirm-return`); await reimbursed(r.order); await resolved(r.order, ['FAILED', 'SUCCEEDED']); } else { assert.equal(current.status, 'delivered'); await resolved(r.order, ['SUCCEEDED', 'SUCCEEDED']); }
    const next = await order(false); const p = await Promise.all([buyer.post(`/api/orders/${next.order.id}/pay`, {}, null), buyer.post(`/api/orders/${next.order.id}/pay`, {}, null)]); assert.ok(p.every(r => [200, 409].includes(r.statusCode))); await state(next.order, 'ACCEPTED', 'ACCEPTED'); await seller.post(`/api/orders/${next.order.id}/refund`, { reason: 'Clôture du test de double clic' }); await resolved(next.order, ['FAILED', 'FAILED']);
  });
  await check('état final Lightning : aucune opération ni HTLC restant, canaux actifs', async () => {
    assert.equal(db.one('SELECT COUNT(*) n FROM order_actions').n, 0); assert.equal(db.one("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('delivered','returned','canceled')").n, 0);
    for (const node of ln.all) { const c = await node.channels(); assert.ok(c.every(c => c.is_active && c.unsettled_balance === 0)); }
  });
  save({ completed: true, passed: checks.length });
}
main().catch(error => { console.error('Échec validation Polar :', error.message); save({ error: error.message }); process.exitCode = 1; }).finally(async () => {
  for (const name of paused) { try { await docker('unpause', name); } catch {} }
  if (refundGate && worker?.exitCode === null) { try { await command('release-refund'); } catch {} }
  for (const [node, hash] of invoices) { try { const inv = await node.lookup(hash); if (['OPEN', 'ACCEPTED'].includes(inv.state)) await node.cancel(hash); } catch {} }
  await stopWorker().catch(() => worker?.kill()); if (dbOpened) db.close(); fs.closeSync(workerLog); process.exit(process.exitCode || 0);
});
