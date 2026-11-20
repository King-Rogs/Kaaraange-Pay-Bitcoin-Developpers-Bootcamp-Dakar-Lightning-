'use strict';
/** Jeu persistant distinct de Polar. Aucune connexion à un nœud réel. */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
Object.assign(process.env, { DB_PATH: 'data/kaaraange-scenarios.db', LND_MODE: 'mock', BTC_MODE: 'mock', SIMULATION: 'false', SEED_DEMO: 'true', PRICE_MODE: 'fixed', BTC_XOF_FALLBACK: '60000000', DEV_MODE: 'true', ADMIN_EMAIL: 'admin@kaaraange.sn', COOKIE_SECURE: 'false' });
const { createServer } = require('../src/server');
const config = require('../src/config');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const { now } = require('../src/util');
let srv, base;
class Client {
  async req(method, url, body) {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: this.cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) this.cookie = c.split(';')[0];
    const data = await r.json(); if (!r.ok) throw new Error(`${url} : ${data.error}`); return data;
  }
  post(url, body = {}) { return this.req('POST', url, body); }
  get(url) { return this.req('GET', url); }
  login(name) { return this.post('/api/auth/login', { email: `${name}@demo.kaaraange.sn`, password: 'demo1234' }); }
}
async function main() {
  srv = await createServer({ loops: false });
  if (db.kvGet('demo_scenarios_v1')) { console.log('Jeu de simulation déjà préparé ; commandes conservées.'); return; }
  // Une base déjà utilisée n’est jamais réinitialisée par ce script.
  if (db.one('SELECT COUNT(*) n FROM orders').n) throw new Error('Cette base contient déjà des commandes. Elles sont conservées ; préparation interrompue.');
  const accessFile = path.join(config.root, 'data', 'demo-access.json');
  const access = fs.existsSync(accessFile) ? JSON.parse(fs.readFileSync(accessFile, 'utf8')) : { email: 'admin@kaaraange.sn', password: `Kp-${crypto.randomBytes(15).toString('base64url')}!9` };
  if (!db.one('SELECT id FROM users WHERE email = ?', access.email)) db.run('INSERT INTO users (email,name,password_hash,is_admin,is_demo,created_at) VALUES (?,?,?,1,1,?)', access.email, 'Administration (simulation)', await hashPassword(access.password), now());
  fs.writeFileSync(path.join(config.root, 'data', 'simulation-access.json'), JSON.stringify(access, null, 2), { mode: 0o600 });
  const server = await srv.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${server.address().port}`;
  const buyer = new Client(), seller = new Client(), courier = new Client();
  await buyer.login('fatou'); await seller.login('awa'); await courier.login('moussa');
  const article = db.one("SELECT a.*,u.shop_lat,u.shop_lng FROM articles a JOIN users u ON u.id = a.seller_id WHERE title = 'Robe wax ndokette'");
  async function ride(pickup = true) {
    await courier.post('/api/courier/status', { status: 'available', mode: 'sim', lat: article.shop_lat, lng: article.shop_lng });
    const code = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(Buffer.from(code, 'hex')).digest('hex');
    const { order } = await buyer.post('/api/orders', { article_id: article.id, item_hash: hash, lat: 14.69, lng: -17.445, address: 'Point de démonstration, Dakar' });
    await buyer.post(`/api/orders/${order.id}/pay`); await srv.tick();
    const { offer } = await courier.get('/api/courier/me');
    if (!offer) throw new Error('Offre de démonstration introuvable');
    await courier.post(`/api/courier/offers/${offer.id}/accept`);
    if (pickup) await courier.post(`/api/orders/${order.id}/pickup`);
    return { id: order.id, code };
  }
  const delivered = await ride();
  await buyer.post(`/api/orders/${delivered.id}/deliver`, { code: delivered.code });
  await buyer.post(`/api/orders/${delivered.id}/review`, { target: 'produit', rating: 5, comment: 'Exemple de démonstration : produit reçu.' });
  await buyer.post(`/api/orders/${delivered.id}/review`, { target: 'vendeur', rating: 2, comment: 'Avis fictif pour montrer le signalement administrateur.' });
  const refused = await ride(); await buyer.post(`/api/orders/${refused.id}/refuse`, { reason: 'non_conforme', comment: 'Démonstration du retour et du remboursement automatique.' }); await seller.post(`/api/orders/${refused.id}/confirm-return`);
  const canceled = await ride(false); await seller.post(`/api/orders/${canceled.id}/refund`, { reason: 'Exemple : article en rupture avant retrait.' });
  const abandoned = await ride(false); await courier.post(`/api/orders/${abandoned.id}/abandon`, { reason: 'Exemple : indisponibilité avant retrait.' }); await seller.post(`/api/orders/${abandoned.id}/refund`, { reason: 'Annulation de l’exemple après réattribution.' });
  const noShow = await ride(false); db.update('orders', noShow.id, { deadline_at: now() - 1 }); await srv.tick();
  // Les blocs de portefeuille sont minés avant le dernier cas encore bloqué.
  await buyer.post('/api/wallet/create'); await seller.post('/api/wallet/create');
  await buyer.post('/api/wallet/mine', { blocks: 101 });
  const { address } = await seller.post('/api/wallet/address');
  await buyer.post('/api/wallet/send', { address, amount_sat: 50000 }); await buyer.post('/api/wallet/mine', { blocks: 1 });
  const lateReturn = await ride(); await buyer.post(`/api/orders/${lateReturn.id}/refuse`, { reason: 'endommage' }); db.update('orders', lateReturn.id, { return_deadline_at: now() - 1 }); await srv.tick();
  db.kvSet('demo_scenarios_v1', { delivered: delivered.id, refused: refused.id, canceled: canceled.id, abandoned: abandoned.id, no_show: noShow.id, overdue_return: lateReturn.id });
  console.log(JSON.stringify({ ok: true, mode: 'simulation uniquement', orders: 6, database: config.dbPath, start: 'npm run demo:simulate', url: 'http://localhost:5001', admin_access: 'data/simulation-access.json' }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => { if (srv) await srv.stop(); });
