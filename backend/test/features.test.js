'use strict';
/** Couverture des écarts PDF, exclusivement sur les réseaux simulés. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaraange-features-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'features.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), FRONTEND_DIST: path.join(tmp, 'none'), LND_MODE: 'mock', BTC_MODE: 'mock', SEED_DEMO: 'false', SIMULATION: 'false', ADMIN_EMAIL: 'admin@features.test', PRICE_MODE: 'fixed', BTC_XOF_FALLBACK: '60000000', RECOVERY_RETRY_SEC: '0', DEV_MODE: 'true' });
const { createServer } = require('../src/server');
const db = require('../src/db');
const ln = require('../src/lightning');
const { now } = require('../src/util');

test('configuration : refuse une marge HTLC trop courte ou un délai incohérent', () => {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, DEADLINE_MIN: '120', RETURN_DEADLINE_MIN: '120', INVOICE_EXPIRY_MIN: '30', HOLD_CLTV_DELTA: '288' };
  const run = extra => spawnSync(process.execPath, ['-e', "require('./src/config')"], { cwd: path.resolve(__dirname, '..'), env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(run({}).status, 0);
  assert.notEqual(run({ HOLD_CLTV_DELTA: '38' }).status, 0);
  assert.notEqual(run({ RETURN_DEADLINE_MIN: '-1' }).status, 0);
  assert.notEqual(run({ LOW_RATING_THRESHOLD: '8' }).status, 0);
});
let srv, base, article, courierId;
const shop = { lat: 14.6822, lng: -17.4535, address: 'Médina' };
class Client {
  async request(method, url, body, expected = 200, form) {
    const res = await fetch(base + url, { method, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(!form && body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
    for (const c of res.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const result = await res.json();
    if (expected !== null) assert.equal(res.status, expected, `${method} ${url}: ${result.error || res.status}`);
    return { ...result, statusCode: res.status };
  }
  get(url, status) { return this.request('GET', url, undefined, status); }
  post(url, body = {}, status) { return this.request('POST', url, body, status); }
  patch(url, body, status) { return this.request('PATCH', url, body, status); }
  async register(name) { return (await this.post('/api/auth/register', { name, email: `${name}@features.test`, password: 'Features1234' }, 201)).user; }
}
const buyer = new Client(), seller = new Client(), courier = new Client(), other = new Client(), admin = new Client(), anon = new Client();
async function start() { srv = await createServer({ loops: false }); const server = await srv.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${server.address().port}`; }
before(async () => {
  await start();
  await admin.register('admin'); await seller.register('seller'); await buyer.register('buyer');
  courierId = (await courier.register('courier')).id; await other.register('other');
  await seller.patch('/api/me', { shop, shop_name: 'Atelier des tests' });
  article = (await seller.post('/api/articles', { title: 'Robe de test', description: 'Article de démonstration', price_sat: 25000 }, 201)).article;
});

async function order(pay = true) {
  const secret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex');
  let result = await buyer.post('/api/orders', { article_id: article.id, item_hash: hash, lat: 14.69, lng: -17.445, address: 'Dakar' }, 201);
  if (pay) result = await buyer.post(`/api/orders/${result.order.id}/pay`);
  return { order: result.order, secret };
}
async function ride(pickup = true) {
  await courier.post('/api/courier/status', { status: 'available', mode: 'sim', lat: shop.lat, lng: shop.lng });
  const result = await order();
  await srv.tick();
  const { offer } = await courier.get('/api/courier/me');
  assert.ok(offer);
  await courier.post(`/api/courier/offers/${offer.id}/accept`);
  if (pickup) await courier.post(`/api/orders/${result.order.id}/pickup`);
  return result;
}

test('page produit et catalogue accessibles sans session ; aucune donnée privée exposée', async () => {
  const result = await anon.get(`/api/public/articles/${article.id}`);
  assert.equal(result.article.title, article.title);
  assert.equal(result.article.public_path, `/produit/${article.id}`);
  assert.deepEqual(result.article.rating, { avg: null, count: 0 });
  assert.ok(!JSON.stringify(result).includes('seller@features.test'));
  assert.equal(result.article.seller.phone, undefined);
  assert.ok((await anon.get('/api/public/articles?q=robe')).articles.some(a => a.id === article.id));
  await anon.get('/api/articles', 401);
});

test('photo article : propriétaire uniquement, véritable image et affichage public', async () => {
  const form = () => { const f = new FormData(); f.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'photo.png'); return f; };
  await other.request('POST', `/api/articles/${article.id}/image`, undefined, 404, form());
  const bad = new FormData(); bad.append('image', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'fake.png');
  await seller.request('POST', `/api/articles/${article.id}/image`, undefined, 400, bad);
  const result = await seller.request('POST', `/api/articles/${article.id}/image`, undefined, 200, form());
  assert.match(result.article.image_url, /^\/uploads\/article-/);
  const image = await fetch(base + result.article.image_url);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);
});

test('avis produit : achat vérifié, note distincte du vendeur et moyenne publique', async () => {
  const unpaid = await order(false);
  await buyer.post(`/api/orders/${unpaid.order.id}/review`, { target: 'produit', rating: 5 }, 400);
  await buyer.post(`/api/orders/${unpaid.order.id}/cancel`);
  const result = await ride();
  await buyer.post(`/api/orders/${result.order.id}/deliver`, { code: result.secret });
  await other.post(`/api/orders/${result.order.id}/review`, { target: 'produit', rating: 5 }, 404);
  await seller.post(`/api/orders/${result.order.id}/review`, { target: 'produit', rating: 5 }, 403);
  await buyer.post(`/api/orders/${result.order.id}/review`, { target: 'produit', rating: 4, comment: 'Produit vérifié' }, 201);
  await buyer.post(`/api/orders/${result.order.id}/review`, { target: 'vendeur', rating: 2, comment: 'Service à améliorer' }, 201);
  await buyer.post(`/api/orders/${result.order.id}/review`, { target: 'produit', rating: 1 }, 409);
  const page = await anon.get(`/api/public/articles/${article.id}`);
  assert.deepEqual(page.article.rating, { avg: 4, count: 1 });
  assert.equal(page.reviews[0].comment, 'Produit vérifié');
  assert.ok((await admin.get('/api/admin/alerts')).alerts.some(a => a.type === 'low_rating'));
});

test('annulation LND indisponible : 202 et fonds encore bloqués, reprise confirmée ensuite', async () => {
  const { order: o } = await ride(false);
  const cancel = ln.vendeur.cancel;
  ln.vendeur.cancel = async () => { throw [503, 'Unavailable']; };
  try {
    const result = await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Article indisponible' }, 202);
    assert.equal(result.order.status, 'cancel_pending');
    assert.equal(result.order.invoices.item.state, 'ACCEPTED');
    assert.ok(result.order.financial_error);
    assert.equal((await courier.get('/api/courier/me')).courier.status, 'busy');
  } finally { ln.vendeur.cancel = cancel; }
  await srv.tick();
  const closed = (await buyer.get(`/api/orders/${o.id}`)).order;
  assert.equal(closed.status, 'canceled');
  assert.equal(closed.invoices.item.state, 'CANCELED');
  assert.equal(closed.invoices.fee.state, 'CANCELED');
  assert.equal((await courier.get('/api/courier/me')).courier.status, 'available');
});

test('coupure entre article et livraison : intention persistée, reprise après redémarrage', async () => {
  const { order: o, secret } = await ride();
  const settle = ln.livreur.settle;
  ln.livreur.settle = async () => { throw [503, 'Unavailable']; };
  try {
    const result = await buyer.post(`/api/orders/${o.id}/deliver`, { code: secret }, 202);
    assert.equal(result.order.status, 'delivery_pending');
    assert.equal(result.order.invoices.item.state, 'SETTLED');
    assert.equal(result.order.invoices.fee.state, 'ACCEPTED');
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(db.one('SELECT kind FROM order_actions WHERE order_id = ?', o.id).kind, 'deliver');
  } finally { ln.livreur.settle = settle; }
  await srv.stop(); await start(); await srv.tick();
  const result = await buyer.get(`/api/orders/${o.id}`);
  assert.equal(result.order.status, 'delivered');
  assert.equal(result.order.invoices.fee.state, 'SETTLED');
  assert.equal(db.one('SELECT order_id FROM order_actions WHERE order_id = ?', o.id), null);
  await buyer.post(`/api/orders/${o.id}/deliver`, { code: secret });
});

test('non-présentation : baisse du score, incident unique et signalement administrateur', async () => {
  const { order: o } = await ride(false);
  const before = (await courier.get('/api/courier/me')).courier.service.score;
  db.update('orders', o.id, { deadline_at: now() - 1 });
  await srv.tick(); await srv.tick();
  const service = (await courier.get('/api/courier/me')).courier.service;
  assert.equal(service.missed_deliveries, 1);
  assert.ok(service.score < before);
  assert.equal((await buyer.get(`/api/orders/${o.id}`)).order.status, 'canceled');
  assert.ok((await admin.get('/api/admin/alerts')).alerts.some(a => a.user_id === courierId && a.type === 'courier_incident'));
});

test('abandon avant retrait : réattribution, livreur hors ligne et aucun mouvement financier', async () => {
  const { order: o } = await ride(false);
  await other.post(`/api/orders/${o.id}/abandon`, { reason: 'Tentative interdite' }, 404);
  const result = await courier.post(`/api/orders/${o.id}/abandon`, { reason: 'Panne du véhicule' });
  assert.equal(result.order.status, 'searching_courier');
  assert.equal(result.order.courier, null);
  assert.equal(result.order.invoices.item.state, 'ACCEPTED');
  assert.equal((await courier.get('/api/courier/me')).courier.status, 'offline');
  await other.post('/api/courier/status', { status: 'available', ...shop });
  await srv.tick();
  const { offer } = await other.get('/api/courier/me');
  assert.ok(offer);
  await other.post(`/api/courier/offers/${offer.id}/accept`);
  await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Course annulée avant le retrait' });
  await other.post('/api/courier/status', { status: 'offline' });
});

test('abandon après retrait : retour obligatoire, paiement du livreur après confirmation', async () => {
  const { order: o } = await ride();
  const result = await courier.post(`/api/orders/${o.id}/abandon`, { reason: 'Impossible de terminer' });
  assert.equal(result.order.status, 'returning');
  assert.equal(result.order.return_cause, 'abandon');
  assert.equal(result.order.invoices.item.state, 'CANCELED');
  assert.equal(result.order.invoices.fee.state, 'ACCEPTED');
  assert.equal((await courier.get('/api/courier/me')).courier.status, 'busy');
  const returned = await seller.post(`/api/orders/${o.id}/confirm-return`);
  assert.equal(returned.order.invoices.fee.state, 'SETTLED');
});

test('remboursement volontaire après retrait : retour puis livraison prise en charge par le vendeur', async () => {
  const { order: o } = await ride();
  await seller.post(`/api/orders/${o.id}/refund`, { reason: '' }, 400);
  const result = await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Erreur de préparation' });
  assert.equal(result.order.return_cause, 'vendeur');
  const returned = await seller.post(`/api/orders/${o.id}/confirm-return`);
  assert.equal(returned.order.fee_refund_status, 'completed');
});

test('retour hors délai : signalement, arbitrage et disparition de l’alerte après traitement', async () => {
  const { order: o } = await ride();
  const refused = await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'non_conforme' });
  assert.ok(refused.order.return_deadline_at > now());
  db.update('orders', o.id, { return_deadline_at: now() - 1 });
  await srv.tick();
  assert.equal((await buyer.get(`/api/orders/${o.id}`)).order.return_overdue, true);
  assert.ok((await admin.get('/api/admin/alerts')).alerts.some(a => a.type === 'return_overdue' && a.order_id === o.id));
  await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay', reason: 'Retour vérifié après dépassement du délai' });
  assert.equal((await buyer.get(`/api/orders/${o.id}`)).order.fee_refund_status, 'completed');
  assert.ok(!(await admin.get('/api/admin/alerts')).alerts.some(a => a.type === 'return_overdue' && a.order_id === o.id));
});

test('double clic Payer : une seule émission pour chaque facture', async () => {
  const { order: o } = await order(false);
  const pay = ln.acheteur.payAsync;
  let calls = 0;
  ln.acheteur.payAsync = (...args) => { calls++; return pay(...args); };
  try {
    const results = await Promise.all([buyer.post(`/api/orders/${o.id}/pay`, {}, null), buyer.post(`/api/orders/${o.id}/pay`, {}, null)]);
    assert.ok(results.every(r => r.statusCode === 200));
    assert.equal(calls, 2);
  } finally { ln.acheteur.payAsync = pay; }
  await seller.post(`/api/orders/${o.id}/refund`, { reason: 'Fin du test' });
});

test('arbitrage des frais : motif obligatoire, conservé après panne et dans l’audit', async () => {
  const { order: o } = await ride();
  await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'non_conforme' });
  for (const reason of [undefined, '', '  ', 'ab', 'x'.repeat(201)]) {
    const result = await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay', reason }, 400);
    assert.equal(result.field, 'reason');
    assert.equal(db.one('SELECT status FROM orders WHERE id = ?', o.id).status, 'returning');
  }
  const settle = ln.livreur.settle;
  ln.livreur.settle = async () => { throw [503, 'Incident de confirmation']; };
  const reason = 'Retour physique contrôlé et confirmé par administration';
  try { await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay', reason }, 202); }
  finally { ln.livreur.settle = settle; }
  const intention = db.one('SELECT details FROM order_actions WHERE order_id = ?', o.id);
  assert.equal(JSON.parse(intention.details).reason, reason);
  await srv.tick();
  assert.equal(db.one('SELECT status FROM orders WHERE id = ?', o.id).status, 'returned');
  const audit = db.one("SELECT details FROM audit WHERE target = ? AND action = 'admin.frais_payes_livreur' ORDER BY id DESC LIMIT 1", `order:${o.id}`);
  assert.equal(JSON.parse(audit.details).reason, reason);
});

test('arbitrage concurrent paiement/annulation : une seule décision, motif traçable', async () => {
  const { order: o } = await ride();
  await buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' });
  await admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'cancel' }, 400);
  const results = await Promise.all([
    admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'pay', reason: 'Colis retourné et course constatée' }, null),
    admin.post(`/api/admin/orders/${o.id}/fee`, { action: 'cancel', reason: 'Course contestée après vérification' }, null),
  ]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(db.one('SELECT status FROM orders WHERE id = ?', o.id).status, 'returned');
  assert.equal(db.one("SELECT COUNT(*) n FROM audit WHERE target = ? AND action IN ('admin.frais_payes_livreur','admin.frais_annules')", `order:${o.id}`).n, 1);
});

test('livraison et refus concurrents : un seul résultat financier autorisé', async () => {
  const { order: o, secret } = await ride();
  const results = await Promise.all([buyer.post(`/api/orders/${o.id}/deliver`, { code: secret }, null), buyer.post(`/api/orders/${o.id}/refuse`, { reason: 'autre' }, null)]);
  assert.equal(results.filter(r => r.statusCode === 200).length, 1);
  assert.equal(results.filter(r => r.statusCode === 409).length, 1);
  const result = (await buyer.get(`/api/orders/${o.id}`)).order;
  if (result.status === 'returning') await seller.post(`/api/orders/${o.id}/confirm-return`);
  else assert.equal(result.status, 'delivered');
});

after(async () => {
  if (srv) await srv.stop();
  assert.equal(path.dirname(path.resolve(tmp)), path.resolve(os.tmpdir()));
  assert.match(path.basename(tmp), /^kaaraange-features-/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
