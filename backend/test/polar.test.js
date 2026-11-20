'use strict';
/** Test explicite sur un réseau Polar financé : vrais HTLC, base applicative isolée. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaraange-polar-'));
Object.assign(process.env, {
  DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'),
  SIMULATION: 'false', SEED_DEMO: 'true', PRICE_MODE: 'fixed',
  BTC_XOF_FALLBACK: '60000000', ADMIN_EMAIL: '', OFFER_SECONDS: '120',
});
const config = require('../src/config');
const { createServer } = require('../src/server');
const ln = require('../src/lightning');
const bitcoin = require('../src/bitcoin');
const db = require('../src/db');
let srv, base;
const invoices = [];

class Client {
  async req(method, url, body, expected = 200) {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', cookie: this.cookie || '' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    for (const cookie of res.headers.getSetCookie()) this.cookie = cookie.split(';')[0];
    const data = await res.json();
    assert.equal(res.status, expected, `${method} ${url}: ${data.error || res.status}`);
    return data;
  }
  get(url) { return this.req('GET', url); }
  post(url, body = {}, expected = 200) { return this.req('POST', url, body, expected); }
  login(name) { return this.post('/api/auth/login', { email: `${name}@demo.kaaraange.sn`, password: 'demo1234' }); }
}
const buyer = new Client(), seller = new Client(), courier = new Client();

// Le destinataire voit SETTLED avant la propagation de la résolution au payeur.
async function waitPayments(order, expected) {
  const hashes = [order.invoices.item.hash, order.invoices.fee.hash];
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const { payments } = await ln.acheteur.history();
    if (hashes.every((hash, i) => payments.some(p => p.id === hash && p.status === expected[i]))) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Les paiements ne sont pas encore résolus chez Fatou.');
}

async function main() {
  assert.equal(config.lndMode, 'lnd', 'Ce test exige LND_MODE=lnd et un réseau Polar financé.');
  assert.equal(config.btcMode, 'rpc', 'Ce test exige BTC_MODE=rpc.');
  srv = await createServer({ loops: false });
  assert.equal((await bitcoin.chain.chainInfo()).chain, 'regtest', 'Seul le regtest est autorisé.');
  const server = await srv.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
  const health = await buyer.get('/api/health');
  assert.ok(health.nodes.every(n => n.reachable));
  await Promise.all([buyer.login('fatou'), seller.login('awa'), courier.login('moussa')]);
  const article = (await buyer.get('/api/articles')).articles.find(a => a.title.includes('Robe'));
  assert.ok(article);
  const shop = article.seller.shop;
  await courier.post('/api/courier/status', { status: 'available', mode: 'sim', lat: shop.lat, lng: shop.lng });

  async function startOrder() {
    const secret = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(Buffer.from(secret, 'hex')).digest('hex');
    let { order } = await buyer.post('/api/orders', {
      article_id: article.id, item_hash: hash, lat: shop.lat + 0.005, lng: shop.lng,
      address: 'Validation Polar — Dakar',
    }, 201);
    invoices.push([ln.vendeur, order.invoices.item.hash], [ln.livreur, order.invoices.fee.hash]);
    ({ order } = await buyer.post(`/api/orders/${order.id}/pay`));
    assert.equal(order.status, 'searching_courier');
    assert.equal((await ln.vendeur.lookup(order.invoices.item.hash)).state, 'ACCEPTED');
    assert.equal((await ln.livreur.lookup(order.invoices.fee.hash)).state, 'ACCEPTED');
    const fatouChannels = await ln.acheteur.channels();
    assert.ok(fatouChannels.some(c => c.unsettled_balance > 0), 'HTLC réellement verrouillés sur Fatou');
    assert.ok((await ln.acheteur.balances()).pending_out_sat >= order.total_sat, 'Montant bloqué visible dans la console');
    const held = (await ln.acheteur.history()).payments;
    assert.ok([order.invoices.item.hash, order.invoices.fee.hash].every(hash => held.some(p => p.id === hash && p.status === 'IN_FLIGHT')), 'Deux paiements en cours visibles');
    await srv.tick();
    const { offer } = await courier.get('/api/courier/me');
    assert.ok(offer, 'Offre de livraison destinée à Moussa');
    await courier.post(`/api/courier/offers/${offer.id}/accept`);
    await courier.post(`/api/orders/${order.id}/pickup`);
    return { order, secret };
  }

  const accepted = await startOrder();
  await buyer.post(`/api/orders/${accepted.order.id}/deliver`, { code: '0'.repeat(64) }, 400);
  assert.equal((await ln.vendeur.lookup(accepted.order.invoices.item.hash)).state, 'ACCEPTED');
  let { order } = await buyer.post(`/api/orders/${accepted.order.id}/deliver`, { code: accepted.secret });
  assert.equal(order.status, 'delivered');
  assert.equal((await ln.vendeur.lookup(order.invoices.item.hash)).state, 'SETTLED');
  assert.equal((await ln.livreur.lookup(order.invoices.fee.hash)).state, 'SETTLED');
  await waitPayments(order, ['SUCCEEDED', 'SUCCEEDED']);
  console.log('OK Polar : deux HTLC acceptés, mauvais code refusé, article et livraison réglés.');

  const refused = await startOrder();
  ({ order } = await buyer.post(`/api/orders/${refused.order.id}/refuse`, { reason: 'non_conforme', comment: 'Test Polar' }));
  assert.equal(order.status, 'returning');
  assert.equal((await ln.vendeur.lookup(order.invoices.item.hash)).state, 'CANCELED');
  assert.equal((await ln.livreur.lookup(order.invoices.fee.hash)).state, 'ACCEPTED');
  ({ order } = await seller.post(`/api/orders/${order.id}/confirm-return`));
  assert.equal(order.status, 'returned');
  assert.equal((await ln.livreur.lookup(order.invoices.fee.hash)).state, 'SETTLED');
  await waitPayments(order, ['FAILED', 'SUCCEEDED']);
  const refundDeadline = Date.now() + 70000;
  while (order.fee_refund_status === 'pending' && Date.now() < refundDeadline) {
    await srv.tick();
    ({ order } = await buyer.get(`/api/orders/${order.id}`));
    if (order.fee_refund_status === 'pending') await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.equal(order.fee_refund_status, 'completed', 'Remboursement automatique de la livraison par Awa');
  const refunded = db.one('SELECT fee_refund_hash FROM orders WHERE id = ?', order.id).fee_refund_hash;
  assert.equal((await ln.acheteur.lookup(refunded)).state, 'SETTLED');
  const reimbursement = (await ln.vendeur.history()).payments.find(p => p.id === refunded);
  assert.equal(reimbursement?.status, 'SUCCEEDED');
  assert.equal(reimbursement.tokens, order.fee_sat);
  console.log('OK Polar : refus, livreur payé au retour, livraison automatiquement remboursée par Awa à Fatou.');
  assert.equal(db.one("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('delivered','returned')").n, 0);
}

main().then(async () => {
  await srv.stop();
  process.exit(0);
}, async error => {
  console.error('Échec du test Polar :', error.message || error);
  for (const [node, hash] of invoices) {
    try { if (['OPEN', 'ACCEPTED'].includes((await node.lookup(hash)).state)) await node.cancel(hash); } catch {}
  }
  if (srv) await srv.stop();
  process.exit(1);
});
