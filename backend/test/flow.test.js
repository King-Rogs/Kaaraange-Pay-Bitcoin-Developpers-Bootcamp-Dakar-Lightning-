'use strict';
/**
 * Test de bout en bout de Kaaraange Pay (npm test).
 * Serveur réel sur un port aléatoire, base SQLite temporaire, réseau Lightning
 * et chaîne Bitcoin simulés, simulation des livreurs désactivée.
 * Les boucles de fond sont appelées à la main (srv.tick) pour un résultat déterministe.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaraange-test-'));
Object.assign(process.env, {
  DB_PATH: path.join(TMP, 'test.db'),
  UPLOAD_DIR: path.join(TMP, 'uploads'),
  FRONTEND_DIST: path.join(TMP, 'pas-de-front'),
  LND_MODE: 'mock',
  BTC_MODE: 'mock',
  SIMULATION: 'false',
  SEED_DEMO: 'false',
  PRICE_MODE: 'fixed',
  BTC_XOF_FALLBACK: '60000000',
  DEV_MODE: 'true',
  ADMIN_EMAIL: 'admin@kaaraange.test',
  PUBLIC_URL: 'http://localhost:5173',
  API_KEY: '',
  CORS_ORIGIN: '',
});

const { createServer } = require('../src/server');
const db = require('../src/db');
const ln = require('../src/lightning');
const dispatch = require('../src/dispatch');
const { haversine } = require('../src/util');

const MEDINA = { lat: 14.6822, lng: -17.4535 };
const PLATEAU = { lat: 14.6928, lng: -17.4467 };
const SACRE_COEUR = { lat: 14.7167, lng: -17.4677 };
const near = (p, km) => ({ lat: p.lat + km / 111, lng: p.lng });
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let srv;
let base;

/** Client HTTP qui garde son cookie de session, comme un navigateur. */
class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }
  async req(method, url, body, { form } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      if (pair.startsWith('kp_session=')) this.cookie = /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) ? '' : pair;
    }
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* réponse non JSON (CSV…) */
    }
    return { status: res.status, data, text, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  patch(u, b) { return this.req('PATCH', u, b); }
  put(u, b) { return this.req('PUT', u, b); }
  del(u, b) { return this.req('DELETE', u, b); }
}

function expectStatus(r, status, label) {
  assert.equal(r.status, status, `${label || ''} → HTTP ${r.status} : ${typeof r.data === 'object' ? JSON.stringify(r.data) : r.text}`);
  return r.data;
}

const newCode = () => {
  const preimage = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
  return { preimage, hash };
};

const channel = (a, b) => ln.network.state.channels.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
const pendingOffers = (orderId) => db.all("SELECT * FROM offers WHERE order_id = ? AND status = 'pending'", orderId);
const courierRow = (userId) => db.one('SELECT * FROM couriers WHERE user_id = ?', userId);

const admin = new Client('admin');
const seller = new Client('vendeuse');
const buyer = new Client('acheteuse');
const c1 = new Client('livreur proche');
const c2 = new Client('livreur éloigné');
const anon = new Client('visiteur');
const users = {};
let article;
let order1;
let order2;
let code1;

async function register(client, name, email, password = 'motdepasse1') {
  const d = expectStatus(await client.post('/api/auth/register', { name, email, password, remember: true }), 201, `inscription ${email}`);
  users[client.name] = d.user;
  return d.user;
}

async function createPaidOrder(client, delivery = PLATEAU) {
  const code = newCode();
  const o = expectStatus(await client.post('/api/orders', { article_id: article.id, lat: delivery.lat, lng: delivery.lng, address: 'Adresse de test', item_hash: code.hash }), 201, 'commande');
  const paid = expectStatus(await client.post(`/api/orders/${o.order.id}/pay`), 200, 'paiement');
  assert.equal(paid.order.status, 'searching_courier');
  return { order: paid.order, code };
}

/** Le livreur qui a l'offre en attente pour cette commande. */
function clientWithOffer(orderId) {
  const [f] = pendingOffers(orderId);
  assert.ok(f, `aucune offre en attente pour la commande ${orderId}`);
  return { offer: f, client: [c1, c2].find((c) => users[c.name].id === f.courier_id) };
}

test('démarrage du serveur (port aléatoire, base temporaire)', async () => {
  srv = await createServer({ loops: false });
  const server = await srv.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
  const h = expectStatus(await anon.get('/api/health'), 200);
  assert.equal(h.status, 'ok');
  assert.equal(h.nodes.length, 3);
});

/* ======================= Comptes et profil ======================= */

test('inscription : e-mail invalide, mot de passe faible, doublon', async () => {
  let r = await anon.post('/api/auth/register', { name: 'Test', email: 'pas-un-email', password: 'motdepasse1' });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'email');
  r = await anon.post('/api/auth/register', { name: 'Test', email: 'test@kaaraange.test', password: 'court1' });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'password');
  r = await anon.post('/api/auth/register', { name: 'Test', email: 'test@kaaraange.test', password: 'sanschiffres' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /lettres et des chiffres/);

  await register(admin, 'Admin Kaaraange', 'admin@kaaraange.test');
  assert.equal(users.admin.is_admin, true, 'ADMIN_EMAIL promu administrateur');
  await register(seller, 'Awa Couture', 'awa@kaaraange.test');
  await register(buyer, 'Fatou Ndiaye', 'fatou@kaaraange.test');
  await register(c1, 'Moussa Sarr', 'moussa@kaaraange.test');
  await register(c2, 'Ibou Diallo', 'ibou@kaaraange.test');
  assert.equal(users.vendeuse.is_admin, false);

  r = await anon.post('/api/auth/register', { name: 'Awa bis', email: 'AWA@kaaraange.test', password: 'motdepasse1' });
  assert.equal(r.status, 409);
  assert.equal(r.data.field, 'email');
});

test('connexion refusée, mot de passe oublié avec lien à usage unique', async () => {
  const visitor = new Client('x');
  let r = await visitor.post('/api/auth/login', { email: 'awa@kaaraange.test', password: 'mauvais123' });
  assert.equal(r.status, 401);
  assert.equal(visitor.cookie, '');

  const unknown = expectStatus(await visitor.post('/api/auth/forgot', { email: 'inconnu@kaaraange.test' }), 200);
  const known = expectStatus(await visitor.post('/api/auth/forgot', { email: 'awa@kaaraange.test' }), 200);
  assert.equal(unknown.message, known.message, 'même réponse que le compte existe ou non');
  assert.equal(unknown.dev_link, undefined);
  const token = new URL(known.dev_link).searchParams.get('token');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(db.one('SELECT COUNT(*) n FROM reset_tokens WHERE token_hash = ?', token).n, 0, 'jeton haché en base');

  r = await visitor.post('/api/auth/reset', { token, password: 'faible' });
  assert.equal(r.status, 400);
  expectStatus(await visitor.post('/api/auth/reset', { token, password: 'nouveaumdp2' }), 200);
  r = await visitor.post('/api/auth/reset', { token, password: 'encoreun3' });
  assert.equal(r.status, 400, 'lien à usage unique');

  // La réinitialisation a fermé toutes les sessions de la vendeuse.
  r = await seller.get('/api/auth/me');
  assert.equal(r.data.user, null);
  expectStatus(await seller.post('/api/auth/login', { email: 'awa@kaaraange.test', password: 'nouveaumdp2', remember: true }), 200);
  const me = expectStatus(await seller.get('/api/auth/me'), 200);
  assert.equal(me.user.email, 'awa@kaaraange.test');
  assert.equal(me.user.password_hash, undefined);
  assert.match(db.one('SELECT password_hash FROM users WHERE id = ?', me.user.id).password_hash, /^scrypt\$/);
});

test('profil, position de la boutique et changement de mot de passe', async () => {
  let r = await seller.patch('/api/me', { shop: { lat: 200, lng: 0 } });
  assert.equal(r.status, 400);
  const d = expectStatus(await seller.patch('/api/me', { name: 'Awa Couture', phone: '+221 77 123 45 67', shop_name: 'Awa Couture', shop: { ...MEDINA, address: 'Médina, Dakar' } }), 200);
  assert.deepEqual(d.user.shop, { ...MEDINA, address: 'Médina, Dakar' });
  assert.equal(d.user.shop_name, 'Awa Couture');

  r = await buyer.put('/api/me/password', { current: 'faux', password: 'motdepasse2' });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'current');
  expectStatus(await buyer.put('/api/me/password', { current: 'motdepasse1', password: 'motdepasse2' }), 200);
  expectStatus(await buyer.get('/api/stats'), 200, 'session courante conservée');
});

test('photo de profil : vraie image acceptée, fausse refusée', async () => {
  const fake = new FormData();
  fake.append('avatar', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'piege.png');
  let r = await seller.req('POST', '/api/me/avatar', undefined, { form: fake });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'avatar');

  const real = new FormData();
  real.append('avatar', new Blob([PNG_1PX], { type: 'image/png' }), 'photo.png');
  r = await seller.req('POST', '/api/me/avatar', undefined, { form: real });
  const d = expectStatus(r, 200);
  assert.match(d.user.avatar_url, /^\/uploads\/[0-9a-f]{32}\.png$/, 'nom de fichier aléatoire');
  const img = await fetch(base + d.user.avatar_url);
  assert.equal(img.status, 200);
  assert.equal(Buffer.from(await img.arrayBuffer()).compare(PNG_1PX), 0);

  const big = new FormData();
  big.append('avatar', new Blob([Buffer.concat([PNG_1PX, Buffer.alloc(2.1 * 1024 * 1024)])], { type: 'image/png' }), 'gros.png');
  r = await seller.req('POST', '/api/me/avatar', undefined, { form: big });
  assert.equal(r.status, 413);

  const removed = expectStatus(await buyer.del('/api/me/avatar'), 200);
  assert.equal(removed.user.avatar_url, null);
});

/* ======================= Commande et attribution ======================= */

test('articles et devis (distance, frais, total)', async () => {
  let r = await buyer.post('/api/articles', { title: 'Sans boutique', price_sat: 10_000 });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'shop');
  article = expectStatus(await seller.post('/api/articles', { title: 'Robe wax', description: 'Taille M', price_sat: 50_000 }), 201).article;
  assert.equal(article.price_sat, 50_000);
  const list = expectStatus(await buyer.get('/api/articles?q=wax'), 200);
  assert.equal(list.articles.length, 1);
  assert.equal(list.articles[0].is_mine, false);

  const q = expectStatus(await buyer.post('/api/quote', { article_id: article.id, ...PLATEAU }), 200);
  const km = Math.round(haversine(MEDINA.lat, MEDINA.lng, PLATEAU.lat, PLATEAU.lng) * 1.3 * 100) / 100;
  const feeXof = Math.round((500 + 150 * km) / 25) * 25;
  assert.equal(q.distance_km, km);
  assert.equal(q.fee_xof, feeXof);
  assert.equal(q.fee_xof % 25, 0);
  assert.equal(q.fee_sat, Math.ceil((feeXof / 60_000_000) * 1e8));
  assert.equal(q.item_sat, 50_000);
  assert.equal(q.total_sat, 50_000 + q.fee_sat);
  assert.equal(q.btc_xof, 60_000_000);
});

test('le vendeur ne peut pas acheter son propre article', async () => {
  const r = await seller.post('/api/orders', { article_id: article.id, ...PLATEAU, item_hash: newCode().hash });
  assert.equal(r.status, 403);
});

test('commande avec 2 factures, sans exposer le secret B', async () => {
  code1 = newCode();
  let r = await buyer.post('/api/orders', { article_id: article.id, ...PLATEAU, address: 'Plateau', item_hash: 'zz' });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'item_hash');
  const d = expectStatus(await buyer.post('/api/orders', { article_id: article.id, ...PLATEAU, address: 'Plateau, rue Carnot', item_hash: code1.hash }), 201);
  order1 = d.order;
  assert.equal(order1.status, 'awaiting_payment');
  assert.equal(order1.invoices.item.hash, code1.hash);
  assert.equal(order1.invoices.item.node, 'bob');
  assert.equal(order1.invoices.fee.node, 'carol');
  assert.match(order1.invoices.item.request, /^lnbcrt/);
  assert.equal(order1.total_sat, order1.item_sat + order1.fee_sat);

  const secretB = db.one('SELECT fee_preimage FROM orders WHERE id = ?', order1.id).fee_preimage;
  assert.equal(crypto.createHash('sha256').update(Buffer.from(secretB, 'hex')).digest('hex'), order1.invoices.fee.hash);
  for (const who of [buyer, seller]) {
    const raw = (await who.get(`/api/orders/${order1.id}`)).text;
    assert.ok(!raw.includes(secretB), 'le secret B ne sort jamais de l’API');
    assert.ok(!raw.includes('preimage'));
  }
  assert.equal((await c1.get(`/api/orders/${order1.id}`)).status, 404, 'commande invisible pour un tiers');
});

test('paiement : A et B passent en ACCEPTED, les HTLC sont verrouillés', async () => {
  const before = channel('alice', 'bob').bal.alice;
  const d = expectStatus(await buyer.post(`/api/orders/${order1.id}/pay`), 200);
  order1 = d.order;
  assert.equal(order1.status, 'searching_courier');
  assert.equal(order1.invoices.item.state, 'ACCEPTED');
  assert.equal(order1.invoices.fee.state, 'ACCEPTED');
  assert.ok(order1.deadline_at > order1.paid_at);
  // Prix + frais + 1 sat de frais de routage chez bob pour la facture B.
  assert.equal(before - channel('alice', 'bob').bal.alice, order1.item_sat + order1.fee_sat + 1);
  assert.ok(channel('bob', 'carol').pending >= order1.fee_sat, 'HTLC en attente sur bob → carol');
  const r = await buyer.post(`/api/orders/${order1.id}/pay`);
  assert.equal(r.status, 409, 'pas de double paiement');
});

test('le livreur le plus proche reçoit l’offre, un seul livreur à la fois', async () => {
  expectStatus(await c1.post('/api/courier/status', { status: 'available', mode: 'gps', ...near(MEDINA, 0.3) }), 200);
  expectStatus(await c2.post('/api/courier/status', { status: 'available', mode: 'gps', ...near(MEDINA, 2.5) }), 200);
  // Le vendeur et l'acheteur ne peuvent pas livrer leur propre commande.
  expectStatus(await seller.post('/api/courier/status', { status: 'available', mode: 'gps', ...MEDINA }), 200);
  await srv.tick();
  const offers = pendingOffers(order1.id);
  assert.equal(offers.length, 1, 'un seul livreur sollicité');
  assert.equal(offers[0].courier_id, users['livreur proche'].id);
  const me1 = expectStatus(await c1.get('/api/courier/me'), 200);
  assert.equal(me1.offer.order_id, order1.id);
  assert.ok(me1.offer.seconds_left > 0 && me1.offer.seconds_left <= 30);
  assert.equal(me1.offer.order.fee_sat, order1.fee_sat);
  assert.equal(expectStatus(await c2.get('/api/courier/me'), 200).offer, null);
  expectStatus(await seller.post('/api/courier/status', { status: 'offline' }), 200);
});

test('refus de l’offre : elle passe au suivant ; expiration : nouveau tour', async () => {
  const me1 = expectStatus(await c1.get('/api/courier/me'), 200);
  expectStatus(await c1.post(`/api/courier/offers/${me1.offer.id}/decline`), 200);
  await srv.tick();
  let offers = pendingOffers(order1.id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].courier_id, users['livreur éloigné'].id);

  db.run('UPDATE offers SET expires_at = ? WHERE id = ?', Math.floor(Date.now() / 1000) - 1, offers[0].id);
  await srv.tick();
  assert.equal(db.one('SELECT status FROM offers WHERE id = ?', offers[0].id).status, 'expired');
  offers = pendingOffers(order1.id);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].round, 2, 'tout le monde a été sollicité : nouveau tour');
  assert.equal(offers[0].courier_id, users['livreur proche'].id);
  const c = courierRow(users['livreur proche'].id);
  assert.equal(c.offers_received, 2);
  assert.equal(c.offers_accepted, 0);
});

test('acceptation : le livreur passe en busy ; un livreur occupé ne reçoit pas de nouvelle offre', async () => {
  const me1 = expectStatus(await c1.get('/api/courier/me'), 200);
  const d = expectStatus(await c1.post(`/api/courier/offers/${me1.offer.id}/accept`), 200);
  assert.equal(d.order.status, 'assigned');
  assert.equal(d.order.courier.id, users['livreur proche'].id);
  assert.equal(courierRow(users['livreur proche'].id).status, 'busy');
  let r = await c1.post('/api/courier/status', { status: 'offline' });
  assert.equal(r.status, 409, 'impossible de passer hors ligne en pleine course');

  // Deuxième commande : seul le livreur libre est sollicité, même s'il est plus loin.
  ({ order: order2 } = await createPaidOrder(buyer, SACRE_COEUR));
  for (let i = 0; i < 3; i += 1) await srv.tick();
  const offers = db.all('SELECT * FROM offers WHERE order_id = ?', order2.id);
  assert.ok(offers.length >= 1);
  assert.ok(offers.every((f) => f.courier_id !== users['livreur proche'].id), 'aucune offre au livreur occupé');
  const me2 = expectStatus(await c2.get('/api/courier/me'), 200);
  assert.equal(me2.offer.order_id, order2.id);
  r = await c1.post(`/api/courier/offers/${me2.offer.id}/accept`);
  assert.equal(r.status, 404, 'on ne peut pas accepter l’offre d’un autre');
  expectStatus(await c2.post(`/api/courier/offers/${me2.offer.id}/accept`), 200);
});

/* ======================= Livraison et paiements ======================= */

test('retrait refusé loin de la boutique, accepté sur place', async () => {
  expectStatus(await c1.post('/api/courier/location', near(MEDINA, 2)), 200);
  let r = await c1.post(`/api/orders/${order1.id}/pickup`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /km de la boutique/);
  r = await c2.post(`/api/orders/${order1.id}/pickup`);
  assert.equal(r.status, 404, 'un autre livreur ne voit même pas la commande');
  expectStatus(await c1.post('/api/courier/location', near(MEDINA, 0.1)), 200);
  const d = expectStatus(await c1.post(`/api/orders/${order1.id}/pickup`), 200);
  assert.equal(d.order.status, 'picked_up');
});

test('mauvais code refusé ; un scan règle A et B, les frais arrivent sur carol via bob', async () => {
  let r = await c1.post(`/api/orders/${order1.id}/deliver`, { code: newCode().preimage });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'code');
  r = await c1.post(`/api/orders/${order1.id}/deliver`, { code: 'abc' });
  assert.equal(r.status, 400);

  const bobBefore = channel('alice', 'bob').bal.bob;
  const carolBefore = channel('bob', 'carol').bal.carol;
  const d = expectStatus(await c1.post(`/api/orders/${order1.id}/deliver`, { code: code1.preimage }), 200);
  assert.equal(d.order.status, 'delivered');
  assert.equal(d.order.invoices.item.state, 'SETTLED');
  assert.equal(d.order.invoices.fee.state, 'SETTLED');
  assert.equal(channel('bob', 'carol').bal.carol - carolBefore, order1.fee_sat, 'frais versés à carol');
  assert.equal(channel('alice', 'bob').bal.bob - bobBefore, order1.item_sat + order1.fee_sat + 1, 'prix + transit vers carol');
  const pay = ln.network.state.payments[order1.invoices.fee.hash];
  assert.deepEqual(pay.route, ['alice', 'bob', 'carol'], 'facture B routée en 2 sauts');
  assert.equal(ln.network.state.payments[order1.invoices.item.hash].secret ?? ln.network.state.payments[order1.invoices.item.hash].preimage, code1.preimage, 'preimage révélée au payeur');
  assert.equal(courierRow(users['livreur proche'].id).status, 'available', 'livreur à nouveau disponible');

  const h = expectStatus(await buyer.get('/api/ln/alice/history'), 200);
  assert.ok(h.payments.some((p) => p.id === order1.invoices.fee.hash && p.route.join('>') === 'alice>bob>carol'));
});

test('notes : vendeur, livreur, client ; une seule par cible ; achat vérifié ; droits ; moyenne', async () => {
  let r = await buyer.post(`/api/orders/${order2.id}/review`, { target: 'vendeur', rating: 5 });
  assert.equal(r.status, 400, 'pas de note du vendeur sans livraison');
  r = await seller.post(`/api/orders/${order1.id}/review`, { target: 'vendeur', rating: 5 });
  assert.equal(r.status, 403);
  r = await c1.post(`/api/orders/${order1.id}/review`, { target: 'livreur', rating: 5 });
  assert.equal(r.status, 403);
  r = await buyer.post(`/api/orders/${order1.id}/review`, { target: 'vendeur', rating: 6 });
  assert.equal(r.status, 400);

  expectStatus(await buyer.post(`/api/orders/${order1.id}/review`, { target: 'vendeur', rating: 5, comment: 'Conforme, merci' }), 201);
  expectStatus(await buyer.post(`/api/orders/${order1.id}/review`, { target: 'livreur', rating: 4 }), 201);
  expectStatus(await c1.post(`/api/orders/${order1.id}/review`, { target: 'client', rating: 5 }), 201);
  r = await buyer.post(`/api/orders/${order1.id}/review`, { target: 'vendeur', rating: 1 });
  assert.equal(r.status, 409, 'une seule note par cible');

  const s = expectStatus(await buyer.get(`/api/users/${users.vendeuse.id}/reviews`), 200);
  assert.deepEqual(s.ratings.vendeur, { avg: 5, count: 1 });
  assert.equal(s.reviews[0].comment, 'Conforme, merci');
  const c = expectStatus(await buyer.get(`/api/users/${users['livreur proche'].id}/reviews`), 200);
  assert.deepEqual(c.ratings.livreur, { avg: 4, count: 1 });
  const me = expectStatus(await buyer.get('/api/auth/me'), 200);
  assert.deepEqual(me.user.ratings.client, { avg: 5, count: 1 });
  const o = expectStatus(await buyer.get(`/api/orders/${order1.id}`), 200).order;
  assert.deepEqual(o.can_review, { vendeur: false, livreur: false, client: false, produit: true });
});

test('refus : prix rendu, frais encore bloqués, retour confirmé, livreur payé', async () => {
  let r = await buyer.post(`/api/orders/${order2.id}/refuse`, { reason: 'non_conforme' });
  assert.equal(r.status, 409, 'refus impossible avant le retrait');
  expectStatus(await c2.post('/api/courier/location', near(MEDINA, 0.2)), 200);
  expectStatus(await c2.post(`/api/orders/${order2.id}/pickup`), 200);
  r = await buyer.post(`/api/orders/${order2.id}/refuse`, { reason: 'inconnu' });
  assert.equal(r.status, 400);
  r = await c2.post(`/api/orders/${order2.id}/refuse`, { reason: 'non_conforme' });
  assert.equal(r.status, 403, 'seul le client refuse');

  const aliceBefore = channel('alice', 'bob').bal.alice;
  const d = expectStatus(await buyer.post(`/api/orders/${order2.id}/refuse`, { reason: 'non_conforme', comment: 'Mauvaise couleur' }), 200);
  assert.equal(d.order.status, 'returning');
  assert.equal(d.order.invoices.item.state, 'CANCELED');
  assert.equal(d.order.invoices.fee.state, 'ACCEPTED', 'frais toujours bloqués');
  assert.equal(channel('alice', 'bob').bal.alice - aliceBefore, order2.item_sat, 'prix rendu à l’acheteur');
  assert.equal(courierRow(users['livreur éloigné'].id).status, 'busy', 'le livreur rapporte le colis');

  // Le livreur peut noter le client (refus), l'acheteur peut noter le livreur.
  expectStatus(await c2.post(`/api/orders/${order2.id}/review`, { target: 'client', rating: 2, comment: 'Refus' }), 201);
  r = await buyer.post(`/api/orders/${order2.id}/confirm-return`);
  assert.equal(r.status, 403);
  const carolBefore = channel('bob', 'carol').bal.carol;
  const paySync = ln.vendeur.paySync;
  ln.vendeur.paySync = async () => { throw [503, 'Unavailable']; };
  const back = expectStatus(await seller.post(`/api/orders/${order2.id}/confirm-return`), 200);
  ln.vendeur.paySync = paySync;
  assert.equal(back.order.status, 'returned');
  assert.equal(back.order.invoices.fee.state, 'SETTLED');
  assert.equal(back.order.fee_refund_status, 'pending', 'panne vendeur : remboursement en attente, jamais annoncé comme terminé');
  assert.ok(db.one('SELECT fee_refund_request FROM orders WHERE id = ?', order2.id).fee_refund_request);
  assert.equal(channel('bob', 'carol').bal.carol - carolBefore, order2.fee_sat, 'livreur payé pour son déplacement');
  assert.equal(courierRow(users['livreur éloigné'].id).status, 'available');
  expectStatus(await buyer.post(`/api/orders/${order2.id}/review`, { target: 'livreur', rating: 5 }), 201);
});

test('remboursement automatique : reprise après panne et absence de double paiement', async () => {
  let r = await buyer.post(`/api/admin/orders/${order2.id}/refund-fee`);
  assert.equal(r.status, 403);
  r = await admin.post(`/api/admin/orders/${order1.id}/refund-fee`);
  assert.equal(r.status, 409, 'pas de remboursement des frais pour une commande livrée');
  const aliceBefore = channel('alice', 'bob').bal.alice;
  db.update('orders', order2.id, { fee_refund_attempt_at: 0 });
  await srv.tick();
  const d = expectStatus(await buyer.get(`/api/orders/${order2.id}`), 200);
  assert.equal(d.order.fee_refund_status, 'completed');
  assert.ok(d.order.fee_refunded_at);
  assert.equal(channel('alice', 'bob').bal.alice - aliceBefore, order2.fee_sat, 'facture créée par alice, payée par bob');
  await srv.tick();
  assert.equal(channel('alice', 'bob').bal.alice - aliceBefore, order2.fee_sat, 'un seul remboursement');
  r = await admin.post(`/api/admin/orders/${order2.id}/refund-fee`);
  assert.equal(r.status, 409, 'pas de double remboursement');
});

test('client absent : refusé loin, accepté sur place ; l’admin paie le livreur', async () => {
  const { order } = await createPaidOrder(buyer, SACRE_COEUR);
  await srv.tick();
  const { offer, client } = clientWithOffer(order.id);
  expectStatus(await client.post(`/api/courier/offers/${offer.id}/accept`), 200);
  expectStatus(await client.post('/api/courier/location', MEDINA), 200);
  expectStatus(await client.post(`/api/orders/${order.id}/pickup`), 200);

  let r = await client.post(`/api/orders/${order.id}/absent`);
  assert.equal(r.status, 400, 'absence refusée loin du point de livraison');
  expectStatus(await client.post('/api/courier/location', near(SACRE_COEUR, 0.2)), 200);
  const d = expectStatus(await client.post(`/api/orders/${order.id}/absent`), 200);
  assert.equal(d.order.status, 'returning');
  assert.equal(d.order.return_cause, 'absent');
  assert.equal(d.order.invoices.item.state, 'CANCELED');

  r = await admin.post(`/api/admin/orders/${order.id}/fee`, { action: 'nimporte' });
  assert.equal(r.status, 400);
  const carolBefore = channel('bob', 'carol').bal.carol;
  const paid = expectStatus(await admin.post(`/api/admin/orders/${order.id}/fee`, { action: 'pay', reason: 'Retour du colis vérifié par administration' }), 200);
  assert.equal(paid.order.status, 'returned');
  assert.equal(paid.order.invoices.fee.state, 'SETTLED');
  assert.equal(channel('bob', 'carol').bal.carol - carolBefore, order.fee_sat);
  assert.equal(courierRow(users[client.name].id).status, 'available');
});

test('délai dépassé : A et B annulées, remboursement total, livreur libéré', async () => {
  const aliceBefore = channel('alice', 'bob').bal.alice;
  const { order } = await createPaidOrder(buyer);
  await srv.tick();
  const { offer, client } = clientWithOffer(order.id);
  expectStatus(await client.post(`/api/courier/offers/${offer.id}/accept`), 200);
  assert.equal(courierRow(users[client.name].id).status, 'busy');

  db.run('UPDATE orders SET deadline_at = ? WHERE id = ?', Math.floor(Date.now() / 1000) - 1, order.id);
  await srv.tick();
  const d = expectStatus(await buyer.get(`/api/orders/${order.id}`), 200).order;
  assert.equal(d.status, 'canceled');
  assert.equal(d.cancel_reason, 'delai_depasse');
  assert.equal(d.invoices.item.state, 'CANCELED');
  assert.equal(d.invoices.fee.state, 'CANCELED');
  assert.equal(channel('alice', 'bob').bal.alice, aliceBefore, 'tout est revenu à l’acheteur');
  assert.equal(courierRow(users[client.name].id).status, 'available');
});

test('annulation avant paiement et remboursement admin (motif obligatoire)', async () => {
  const code = newCode();
  const o = expectStatus(await buyer.post('/api/orders', { article_id: article.id, ...PLATEAU, item_hash: code.hash }), 201).order;
  const c = expectStatus(await buyer.post(`/api/orders/${o.id}/cancel`), 200).order;
  assert.equal(c.status, 'canceled');
  assert.equal(c.invoices.item.state, 'CANCELED');

  const { order } = await createPaidOrder(buyer);
  let r = await buyer.post(`/api/orders/${order.id}/cancel`);
  assert.equal(r.status, 409, 'plus d’annulation libre une fois payé');
  r = await admin.post(`/api/admin/orders/${order.id}/refund`, {});
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'reason');
  const d = expectStatus(await admin.post(`/api/admin/orders/${order.id}/refund`, { reason: 'Article en rupture de stock' }), 200);
  assert.equal(d.order.status, 'canceled');
  assert.equal(d.order.invoices.item.state, 'CANCELED');
  assert.equal(d.order.invoices.fee.state, 'CANCELED');
  db.run("UPDATE offers SET status = 'canceled' WHERE status = 'pending'");
});

test('tableau de bord utilisateur', async () => {
  const s = expectStatus(await seller.get('/api/stats'), 200).stats;
  assert.equal(s.earned_seller_sat, order1.item_sat);
  const c = expectStatus(await c1.get('/api/stats'), 200).stats;
  assert.ok(c.courier_earned_sat >= order1.fee_sat);
  const b = expectStatus(await buyer.get('/api/stats'), 200);
  assert.equal(b.stats.locked_sat, 0);
  assert.ok(b.recent.length > 0);
});

/* ======================= Bitcoin et Lightning ======================= */

test('portefeuille : 101 blocs → 50 BTC, envoi, mempool, confirmation', async () => {
  let r = await seller.get('/api/wallet');
  assert.equal(r.data.exists, false);
  r = await seller.post('/api/wallet/mine', { blocks: 1 });
  assert.equal(r.status, 404, 'createwallet d’abord');
  expectStatus(await seller.post('/api/wallet/create'), 201);
  expectStatus(await buyer.post('/api/wallet/create'), 201);
  const addr = expectStatus(await seller.post('/api/wallet/address'), 200).address;
  assert.match(addr, /^bcrt1q[02-9ac-hj-np-z]{30,}$/);

  expectStatus(await seller.post('/api/wallet/mine', { blocks: 100 }), 200);
  let w = expectStatus(await seller.get('/api/wallet'), 200);
  assert.equal(w.balances.trusted_sat, 0, 'coinbase immature avant 101 blocs');
  assert.equal(w.balances.immature_sat, 100 * 50e8);
  expectStatus(await seller.post('/api/wallet/mine', { blocks: 1 }), 200);
  w = expectStatus(await seller.get('/api/wallet'), 200);
  assert.equal(w.balances.trusted_sat, 50e8, '50 BTC disponibles après 101 blocs');

  r = await seller.post('/api/wallet/send', { address: 'pas-une-adresse', amount_sat: 1000 });
  assert.equal(r.status, 400);
  r = await seller.post('/api/wallet/send', { address: addr, amount_sat: 60e8 });
  assert.equal(r.status, 400, 'fonds insuffisants');
  const dest = expectStatus(await buyer.post('/api/wallet/address'), 200).address;
  const sent = expectStatus(await seller.post('/api/wallet/send', { address: dest, amount_sat: 1e8 }), 200);
  assert.equal(sent.fee_sat, 141);
  w = expectStatus(await seller.get('/api/wallet'), 200);
  assert.equal(w.balances.trusted_sat, 50e8 - 1e8 - 141, 'la monnaie rendue reste disponible');
  assert.equal(w.chain.mempool_size, 1);
  let wb = expectStatus(await buyer.get('/api/wallet'), 200);
  assert.equal(wb.balances.untrusted_pending_sat, 1e8);
  assert.equal(wb.balances.trusted_sat, 0);

  expectStatus(await seller.post('/api/wallet/mine', { blocks: 1 }), 200);
  wb = expectStatus(await buyer.get('/api/wallet'), 200);
  assert.equal(wb.balances.trusted_sat, 1e8);
  assert.equal(wb.transactions[0].confirmations, 1);
  assert.equal(wb.chain.mempool_size, 0);

  const chain = expectStatus(await seller.get('/api/btc/chain'), 200);
  assert.equal(chain.blocks, 102);
  const blocks = expectStatus(await seller.get('/api/btc/blocks?limit=5'), 200).blocks;
  assert.equal(blocks[0].height, 102);
  assert.equal(blocks[0].n_tx, 2);
  const blk = expectStatus(await seller.get('/api/btc/block/102'), 200).block;
  assert.equal(blk.txs[0].coinbase, true);
  assert.equal(blk.txs[0].vout[0].value_sat, 50e8 + 141, 'récompense + frais');
  assert.equal((await seller.get('/api/btc/block/99999')).status, 404);
});

test('Lightning : 3 nœuds ; paiement alice → carol en 2 sauts avec preimage vérifiée', async () => {
  const n = expectStatus(await buyer.get('/api/ln/nodes'), 200);
  assert.deepEqual(n.nodes.map((x) => x.id), ['alice', 'bob', 'carol']);
  assert.ok(n.nodes.every((x) => x.reachable && x.info.public_key.length === 66));
  const inv = expectStatus(await buyer.post('/api/ln/carol/invoice', { amount_sat: 1500, memo: 'Test console' }), 201);
  const dec = expectStatus(await buyer.post('/api/ln/decode', { request: inv.request }), 200).decoded;
  assert.equal(dec.tokens, 1500);
  assert.equal(dec.destination_alias, 'carol');
  const pay = expectStatus(await buyer.post('/api/ln/alice/pay', { request: inv.request }), 200);
  assert.deepEqual(pay.route, ['alice', 'bob', 'carol']);
  assert.equal(pay.fee, 1);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(pay.preimage, 'hex')).digest('hex'), inv.id, 'SHA-256(preimage) = payment_hash');
  const again = await buyer.post('/api/ln/alice/pay', { request: inv.request });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /déjà payée/);
  const big = expectStatus(await buyer.post('/api/ln/carol/invoice', { amount_sat: 1_000_000 }), 201);
  const fail = await buyer.post('/api/ln/alice/pay', { request: big.request });
  assert.equal(fail.status, 502);
  assert.match(fail.data.error, /liquidité/);
  assert.equal((await buyer.get('/api/ln/dave/history')).status, 404);
});

/* ======================= Administration ======================= */

test('admin : 401 sans session, 403 pour un utilisateur normal', async () => {
  for (const url of ['/api/admin/stats', '/api/admin/users', '/api/admin/orders', '/api/admin/articles', '/api/admin/dispatch', '/api/admin/system', '/api/admin/audit']) {
    assert.equal((await anon.get(url)).status, 401, url);
    assert.equal((await buyer.get(url)).status, 403, url);
  }
  assert.equal((await buyer.patch(`/api/admin/users/${users.vendeuse.id}`, { is_suspended: true })).status, 403);
});

test('admin : statistiques, dispatch, refus comptés, modération, système', async () => {
  const s = expectStatus(await admin.get('/api/admin/stats'), 200);
  assert.equal(s.users.total, 5);
  assert.ok(s.orders.total >= 6);
  assert.equal(s.orders.by_status.delivered, 1);
  assert.equal(s.paid_sellers_sat, order1.item_sat);
  assert.ok(s.paid_couriers_sat >= order1.fee_sat + order2.fee_sat);
  assert.equal(s.activity_14d.length, 14);

  const dsp = expectStatus(await admin.get('/api/admin/dispatch'), 200);
  assert.ok(dsp.couriers.length >= 2);
  assert.ok(dsp.offers.some((f) => f.status === 'expired') && dsp.offers.some((f) => f.status === 'declined'));
  assert.ok(dsp.offers.every((f) => typeof f.cost === 'number' && typeof f.distance_km === 'number'));

  const u = expectStatus(await admin.get('/api/admin/users?q=fatou'), 200).users;
  assert.equal(u.length, 1);
  assert.equal(u[0].refusals, 1, 'refus comptés par client');
  assert.equal(u[0].absences, 1);
  assert.deepEqual(u[0].ratings.client, { avg: 3.5, count: 2 });
  const csv = await admin.get('/api/admin/users?format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /fatou@kaaraange\.test/);

  const orders = expectStatus(await admin.get('/api/admin/orders?status=returned'), 200).orders;
  assert.equal(orders.length, 2);

  let r = await admin.del(`/api/admin/articles/${article.id}`, {});
  assert.equal(r.status, 400, 'motif obligatoire');
  expectStatus(await admin.del(`/api/admin/articles/${article.id}`, { reason: 'Contrôle de modération' }), 200);
  assert.equal(expectStatus(await buyer.get('/api/articles'), 200).articles.length, 0);
  const arts = expectStatus(await admin.get('/api/admin/articles'), 200).articles;
  assert.equal(arts[0].removed_reason, 'Contrôle de modération');

  const sys = expectStatus(await admin.get('/api/admin/system'), 200);
  assert.equal(sys.nodes.length, 3);
  assert.ok(sys.nodes.every((n) => n.reachable));
  assert.equal(sys.modes.LND_MODE, 'mock');
  assert.equal(sys.bitcoind.reachable, true);
});

test('admin : suspension qui coupe la session, pas de modification de son propre compte', async () => {
  let r = await admin.patch(`/api/admin/users/${users.admin.id}`, { is_suspended: true });
  assert.equal(r.status, 403);
  expectStatus(await admin.patch(`/api/admin/users/${users['livreur éloigné'].id}`, { is_suspended: true }), 200);
  r = await c2.get('/api/courier/me');
  assert.equal(r.status, 401, 'session supprimée immédiatement');
  assert.equal(courierRow(users['livreur éloigné'].id).status, 'offline');
  r = await c2.post('/api/auth/login', { email: 'ibou@kaaraange.test', password: 'motdepasse1' });
  assert.equal(r.status, 403);
  expectStatus(await admin.patch(`/api/admin/users/${users['livreur éloigné'].id}`, { is_suspended: false }), 200);
  expectStatus(await c2.post('/api/auth/login', { email: 'ibou@kaaraange.test', password: 'motdepasse1' }), 200);
  const p = expectStatus(await admin.patch(`/api/admin/users/${users.vendeuse.id}`, { is_admin: true }), 200);
  assert.equal(p.user.is_admin, true);
  // Un compte administrateur n'a pas les droits d'un utilisateur : la vendeuse est
  // redescendue pour que les tests suivants puissent continuer à l'utiliser comme vendeuse.
  const d = expectStatus(await admin.patch(`/api/admin/users/${users.vendeuse.id}`, { is_admin: false }), 200);
  assert.equal(d.user.is_admin, false);
});

test('admin : un compte administrateur n’a pas les droits d’un utilisateur', async () => {
  let r = await admin.get('/api/articles');
  assert.equal(r.status, 403);
  r = await admin.post('/api/articles', { title: 'Interdit', price_sat: 1000 });
  assert.equal(r.status, 403);
  r = await admin.post('/api/quote', { article_id: article.id, ...PLATEAU });
  assert.equal(r.status, 403);
  r = await admin.post('/api/orders', { article_id: article.id, ...PLATEAU, item_hash: newCode().hash });
  assert.equal(r.status, 403);
  r = await admin.get('/api/stats');
  assert.equal(r.status, 403);
  r = await admin.post('/api/courier/status', { status: 'available', mode: 'sim', ...PLATEAU });
  assert.equal(r.status, 403);
  // Les routes d'administration restent accessibles.
  expectStatus(await admin.get('/api/admin/stats'), 200);
});

test('admin : journal d’audit complet', async () => {
  const entries = expectStatus(await admin.get('/api/admin/audit?limit=500'), 200).entries;
  const actions = new Set(entries.map((e) => e.action));
  for (const a of [
    'compte.inscription', 'compte.connexion', 'compte.connexion_echouee', 'compte.mot_de_passe_oublie', 'compte.mot_de_passe_reinitialise', 'compte.mot_de_passe_modifie',
    'commande.creation', 'commande.paiement', 'offre.acceptee', 'offre.refusee', 'offre.expiree', 'commande.retrait', 'livraison.code_incorrect', 'commande.livree',
    'commande.refus', 'commande.client_absent', 'commande.retour_confirme', 'commande.remboursement_auto', 'commande.annulation',
    'admin.frais_payes_livreur', 'commande.frais_rembourses_par_vendeur', 'admin.remboursement_total', 'admin.retrait_article', 'admin.suspension', 'admin.reactivation', 'admin.nomination',
  ]) {
    assert.ok(actions.has(a), `action absente du journal : ${a}`);
  }
  const failed = entries.find((e) => e.action === 'compte.connexion_echouee');
  assert.equal(failed.details.email, 'awa@kaaraange.test');
});

test('reprise après paiement confirmé mais accusé applicatif perdu : aucun second débit', async () => {
  const before = channel('alice', 'bob').bal.alice;
  db.update('orders', order2.id, { fee_refunded_at: null, fee_refund_attempt_at: 0 });
  const paySync = ln.vendeur.paySync;
  ln.vendeur.paySync = async () => { assert.fail('Une facture déjà réglée ne doit pas être repayée'); };
  try { await srv.tick(); } finally { ln.vendeur.paySync = paySync; }
  assert.ok(db.one('SELECT fee_refunded_at FROM orders WHERE id = ?', order2.id).fee_refunded_at);
  assert.equal(channel('alice', 'bob').bal.alice, before);
});

test('tous les motifs de refus : livraison prise en charge automatiquement par le vendeur', async () => {
  const spentBefore = (await buyer.get('/api/stats')).data.stats.spent_sat;
  db.update('articles', article.id, { is_active: 1 });
  db.run("UPDATE couriers SET status = 'offline'");
  expectStatus(await c1.post('/api/courier/status', { status: 'available', mode: 'sim', ...MEDINA }), 200);
  for (const reason of ['non_conforme', 'endommage', 'change_avis', 'autre']) {
    const { order } = await createPaidOrder(buyer);
    await srv.tick();
    const { offer } = clientWithOffer(order.id);
    expectStatus(await c1.post(`/api/courier/offers/${offer.id}/accept`), 200);
    expectStatus(await c1.post(`/api/orders/${order.id}/pickup`), 200);
    expectStatus(await buyer.post(`/api/orders/${order.id}/refuse`, { reason }), 200);
    const before = channel('alice', 'bob').bal.alice;
    const result = expectStatus(await seller.post(`/api/orders/${order.id}/confirm-return`), 200);
    assert.equal(result.order.fee_refund_status, 'completed', reason);
    assert.equal(channel('alice', 'bob').bal.alice - before, order.fee_sat, reason);
  }
  assert.equal((await buyer.get('/api/stats')).data.stats.spent_sat, spentBefore, 'les frais remboursés ne restent pas comptés comme dépense');
});

test('simulation : création des livreurs fictifs, impossibles à connecter', async () => {
  const created = dispatch.seedBots(3);
  assert.equal(created.length, 3);
  const bots = db.all("SELECT u.*, c.status, c.mode, c.lat FROM users u JOIN couriers c ON c.user_id = u.id WHERE u.is_bot = 1");
  assert.equal(bots.length, 3);
  assert.ok(bots.every((b) => b.status === 'available' && b.mode === 'sim' && b.lat > 14.6 && b.lat < 14.8));
  const r = await anon.post('/api/auth/login', { email: bots[0].email, password: '!bot' });
  assert.equal(r.status, 401);
  assert.equal(dispatch.seedBots(3).length, 0, 'pas de doublon au redémarrage');
});

after(async () => {
  if (srv) await srv.stop();
  assert.equal(path.dirname(path.resolve(TMP)), path.resolve(os.tmpdir()));
  assert.match(path.basename(TMP), /^kaaraange-test-/);
  fs.rmSync(TMP, { recursive: true, force: true });
});
