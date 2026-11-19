'use strict';
/**
 * Articles, devis, commandes à deux hold invoices, livraison, refus, retour,
 * avis et échéances.
 *
 * Règle centrale : chaque commande crée DEUX hold invoices, payées d'un seul clic.
 *  - Facture A (article)   : créée par le nœud vendeur (bob). Le secret est généré
 *    dans le navigateur de l'acheteur : seul son SHA-256 arrive ici. Ce secret est
 *    le code de livraison, montré en QR au livreur.
 *  - Facture B (livraison) : créée par le nœud livreur (carol). Le secret est tiré
 *    au hasard par le serveur, stocké en base et jamais renvoyé par l'API.
 * Un scan du code règle A puis B : vendeur et livreur sont payés ensemble.
 */
const express = require('express');
const config = require('./config');
const db = require('./db');
const ln = require('./lightning');
const price = require('./price');
const v = require('./util');
const { requireAuth, publicUser, ratingsOf } = require('./auth');
const { fail, now, haversine, sha256hex, randomHex, isHex64, round } = v;

const IN_ESCROW = ['searching_courier', 'assigned', 'picked_up'];
const OPEN_STATUSES = ['awaiting_payment', ...IN_ESCROW, 'returning'];
const REFUSE_REASONS = {
  non_conforme: 'Produit non conforme',
  endommage: 'Colis endommagé',
  change_avis: "Changement d'avis",
  autre: 'Autre motif',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dispatch = () => require('./dispatch'); // import différé (dépendance circulaire)

/* ---------- Lecture ---------- */

const getOrder = (id) => db.one('SELECT * FROM orders WHERE id = ?', id);
const getUser = (id) => (id ? db.one('SELECT * FROM users WHERE id = ?', id) : null);

function brief(u, withPhone) {
  if (!u) return null;
  const out = publicUser(u);
  if (withPhone) out.phone = u.phone || '';
  return out;
}

function articleView(a, viewer) {
  const s = getUser(a.seller_id);
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    price_sat: a.price_sat,
    is_active: !!a.is_active,
    removed_reason: a.removed_reason || null,
    created_at: a.created_at,
    is_mine: viewer ? viewer.id === a.seller_id : false,
    seller: {
      ...brief(s),
      rating: ratingsOf(s.id).vendeur,
      shop: s.shop_lat == null ? null : { lat: s.shop_lat, lng: s.shop_lng, address: s.shop_address },
    },
  };
}

/** Ce qu'un utilisateur peut voir d'une commande (jamais le secret B). */
function view(o, viewer) {
  const isBuyer = viewer.id === o.buyer_id;
  const isSeller = viewer.id === o.seller_id;
  const isCourier = viewer.id === o.courier_id;
  const live = OPEN_STATUSES.includes(o.status);
  const buyer = getUser(o.buyer_id);
  const seller = getUser(o.seller_id);
  const courierUser = getUser(o.courier_id);
  const courierPos = o.courier_id ? db.one('SELECT lat, lng, mode, location_at FROM couriers WHERE user_id = ?', o.courier_id) : null;

  const mine = db.all('SELECT role, rating FROM reviews WHERE order_id = ? AND author_id = ?', o.id, viewer.id);
  const myReviews = { vendeur: null, livreur: null, client: null };
  for (const r of mine) myReviews[r.role] = r.rating;

  return {
    id: o.id,
    article_id: o.article_id,
    title: o.title,
    status: o.status,
    role: isBuyer ? 'buyer' : isSeller ? 'seller' : isCourier ? 'courier' : 'admin',
    item_sat: o.item_sat,
    fee_sat: o.fee_sat,
    total_sat: o.item_sat + o.fee_sat,
    fee_xof: o.fee_xof,
    distance_km: o.distance_km,
    btc_xof: o.btc_xof,
    shop: { lat: o.shop_lat, lng: o.shop_lng, address: o.shop_address, name: seller.shop_name || seller.name },
    delivery: { lat: o.delivery_lat, lng: o.delivery_lng, address: o.delivery_address },
    buyer: brief(buyer, live && (isSeller || isCourier || viewer.is_admin)),
    seller: brief(seller, live && (isBuyer || isCourier || viewer.is_admin)),
    courier: courierUser
      ? {
          ...brief(courierUser, live && (isBuyer || isSeller || viewer.is_admin)),
          rating: ratingsOf(courierUser.id).livreur,
          position: courierPos && courierPos.lat != null ? { lat: courierPos.lat, lng: courierPos.lng, mode: courierPos.mode, at: courierPos.location_at } : null,
        }
      : null,
    invoices: {
      item: { label: 'A · article', node: ln.vendeur.id, hash: o.item_hash, request: o.item_request, state: o.item_state, sats: o.item_sat },
      fee: { label: 'B · livraison', node: ln.livreur.id, hash: o.fee_hash, request: o.fee_request, state: o.fee_state, sats: o.fee_sat },
    },
    pay_error: o.pay_error,
    return_cause: o.return_cause,
    refuse_reason: o.refuse_reason,
    refuse_reason_label: o.refuse_reason ? REFUSE_REASONS[o.refuse_reason] : null,
    refuse_comment: o.refuse_comment,
    cancel_reason: o.cancel_reason,
    fee_refunded_at: o.fee_refunded_at,
    invoice_expires_at: o.invoice_expires_at,
    deadline_at: o.deadline_at,
    created_at: o.created_at,
    paid_at: o.paid_at,
    assigned_at: o.assigned_at,
    picked_up_at: o.picked_up_at,
    delivered_at: o.delivered_at,
    returning_at: o.returning_at,
    returned_at: o.returned_at,
    canceled_at: o.canceled_at,
    my_reviews: myReviews,
    can_review: {
      vendeur: isBuyer && o.status === 'delivered' && myReviews.vendeur == null,
      livreur: isBuyer && !!o.courier_id && ['delivered', 'returning', 'returned'].includes(o.status) && myReviews.livreur == null,
      client: isCourier && ['delivered', 'returning', 'returned'].includes(o.status) && myReviews.client == null,
    },
  };
}

function loadForUser(req, id) {
  const o = getOrder(v.idParam(id));
  const u = req.user;
  if (!o || (u.id !== o.buyer_id && u.id !== o.seller_id && u.id !== o.courier_id && !u.is_admin)) fail(404, 'Commande introuvable.');
  return o;
}

/* ---------- Synchronisation avec LND ---------- */

async function safeState(node, hash) {
  try {
    return (await node.lookup(hash)).state;
  } catch {
    return null;
  }
}

async function cancelInvoice(node, hash) {
  try {
    await node.cancel(hash);
  } catch {
    /* déjà annulée, déjà réglée ou expirée : rien à faire */
  }
}

/** Annule A et B : tout ce qui était bloqué revient à l'acheteur. */
async function cancelBoth(o) {
  await cancelInvoice(ln.vendeur, o.item_hash);
  await cancelInvoice(ln.livreur, o.fee_hash);
}

/**
 * Relit l'état LND des deux factures et fait avancer la commande :
 * A et B en ACCEPTED → recherche d'un livreur ; une facture expirée → annulation.
 */
async function refresh(o) {
  if (!o || !OPEN_STATUSES.includes(o.status)) return o;
  const [a, b] = await Promise.all([safeState(ln.vendeur, o.item_hash), safeState(ln.livreur, o.fee_hash)]);
  const fields = {};
  if (a && a !== o.item_state) fields.item_state = a;
  if (b && b !== o.fee_state) fields.fee_state = b;
  const sa = a || o.item_state;
  const sb = b || o.fee_state;
  const fresh = getOrder(o.id);
  if (fresh.status === 'awaiting_payment') {
    if (sa === 'ACCEPTED' && sb === 'ACCEPTED') {
      Object.assign(fields, { status: 'searching_courier', paid_at: now(), deadline_at: now() + config.deadlineMin * 60, pay_error: null });
      db.audit(o.buyer_id, 'commande.paiement', `order:${o.id}`, { item_sat: o.item_sat, fee_sat: o.fee_sat });
    } else if (sa === 'CANCELED' || sb === 'CANCELED') {
      await cancelBoth(o);
      Object.assign(fields, {
        status: 'canceled',
        canceled_at: now(),
        cancel_reason: 'facture_expiree',
        item_state: (await safeState(ln.vendeur, o.item_hash)) || 'CANCELED',
        fee_state: (await safeState(ln.livreur, o.fee_hash)) || 'CANCELED',
      });
      db.audit(null, 'commande.annulation_auto', `order:${o.id}`, { motif: 'facture expirée avant paiement complet' });
    }
  }
  if (Object.keys(fields).length) db.update('orders', o.id, fields);
  return getOrder(o.id);
}

async function syncStates(o) {
  const [a, b] = await Promise.all([safeState(ln.vendeur, o.item_hash), safeState(ln.livreur, o.fee_hash)]);
  const fields = {};
  if (a) fields.item_state = a;
  if (b) fields.fee_state = b;
  db.update('orders', o.id, fields);
}

/** Annulation complète (délai dépassé, remboursement admin…). */
async function cancelOrder(o, reason, actorId, action) {
  await cancelBoth(o);
  db.update('orders', o.id, { status: 'canceled', canceled_at: now(), cancel_reason: reason });
  await syncStates(o);
  if (o.courier_id) dispatch().freeCourier(o.courier_id, o.id);
  db.run("UPDATE offers SET status = 'canceled', responded_at = ? WHERE order_id = ? AND status = 'pending'", now(), o.id);
  db.audit(actorId, action, `order:${o.id}`, { motif: reason });
  return getOrder(o.id);
}

/* ---------- Devis ---------- */

async function quote(article, lat, lng) {
  const seller = getUser(article.seller_id);
  if (seller.shop_lat == null) fail(400, "Ce vendeur n'a pas encore placé sa boutique sur la carte.", 'shop');
  const p = await price.get();
  const distance = round(haversine(seller.shop_lat, seller.shop_lng, lat, lng) * config.roadFactor, 2);
  const feeXof = Math.round((config.feeBaseXof + config.feePerKmXof * distance) / 25) * 25;
  const feeSat = price.xofToSat(feeXof, p.btc_xof);
  return {
    distance_km: distance,
    fee_xof: feeXof,
    fee_sat: feeSat,
    item_sat: article.price_sat,
    total_sat: article.price_sat + feeSat,
    btc_xof: Math.round(p.btc_xof),
    price_source: p.source,
    seller,
  };
}

function activeArticle(id) {
  const a = db.one('SELECT a.* FROM articles a JOIN users u ON u.id = a.seller_id WHERE a.id = ? AND a.is_active = 1 AND u.is_suspended = 0', Number(id));
  if (!a) fail(404, "Cet article n'est plus disponible.", 'article_id');
  return a;
}

/* ---------- Échéances (boucle toutes les 2 s) ---------- */

async function tick() {
  for (const o of db.all("SELECT * FROM orders WHERE status = 'awaiting_payment'")) {
    const r = await refresh(o);
    if (r.status === 'awaiting_payment' && r.invoice_expires_at < now() - 5) {
      await cancelOrder(r, 'facture_expiree', null, 'commande.annulation_auto');
    }
  }
  for (const o of db.all(`SELECT * FROM orders WHERE status IN ('searching_courier','assigned','picked_up') AND deadline_at < ?`, now())) {
    await cancelOrder(o, 'delai_depasse', null, 'commande.remboursement_auto');
  }
  // Livraison confirmée mais facture B pas encore réglée (nœud livreur momentanément injoignable) : on réessaie.
  for (const o of db.all("SELECT * FROM orders WHERE fee_state = 'ACCEPTED' AND (status = 'delivered' OR (status = 'returned' AND returned_at IS NOT NULL AND cancel_reason IS NULL))")) {
    try {
      await ln.livreur.settle(o.fee_preimage);
      await syncStates(o);
    } catch {
      /* nouvel essai au prochain tour */
    }
  }
}

/* ---------- Opérations admin (utilisées par admin.js) ---------- */

async function adminRefund(o, reason, adminId) {
  if (!['awaiting_payment', ...IN_ESCROW].includes(o.status)) fail(409, 'Remboursement total possible uniquement avant la remise du colis.');
  return cancelOrder(o, `admin : ${reason}`, adminId, 'admin.remboursement_total');
}

async function adminFee(o, action, adminId) {
  if (o.status !== 'returning') fail(409, 'Action possible uniquement pour un colis en retour.');
  if (action === 'pay') await ln.call(ln.livreur.settle(o.fee_preimage));
  else if (action === 'cancel') await ln.call(ln.livreur.cancel(o.fee_hash));
  else fail(400, 'Action inconnue : « pay » ou « cancel » attendu.', 'action');
  db.update('orders', o.id, { status: 'returned', returned_at: now() });
  await syncStates(o);
  dispatch().freeCourier(o.courier_id, o.id);
  db.audit(adminId, action === 'pay' ? 'admin.frais_payes_livreur' : 'admin.frais_annules', `order:${o.id}`, { fee_sat: o.fee_sat });
  return getOrder(o.id);
}

/** Option A : le vendeur rembourse les frais au client (facture créée par alice, payée par bob). */
async function adminRefundFee(o, adminId) {
  if (o.return_cause !== 'refus' || !['non_conforme', 'endommage'].includes(o.refuse_reason)) {
    fail(409, 'Remboursement des frais par le vendeur réservé aux colis refusés pour non-conformité ou dommage.');
  }
  if (o.status !== 'returned' || o.fee_state !== 'SETTLED') fail(409, "Le livreur doit d'abord avoir été payé (retour confirmé).");
  if (o.fee_refunded_at) fail(409, 'Les frais ont déjà été remboursés.');
  const inv = await ln.call(ln.acheteur.addInvoice(o.fee_sat, `Kaaraange · remboursement des frais #${o.id}`));
  const pay = await ln.call(ln.vendeur.paySync(inv.request));
  db.update('orders', o.id, { fee_refund_hash: inv.id, fee_refunded_at: now() });
  db.audit(adminId, 'admin.frais_rembourses_par_vendeur', `order:${o.id}`, { fee_sat: o.fee_sat, route: pay.route });
  return { order: getOrder(o.id), payment: { id: pay.id, route: pay.route, fee: pay.fee } };
}

/* ---------- Routes ---------- */

const router = express.Router();
router.use(['/articles', '/quote', '/orders', '/stats'], requireAuth);

router.get('/articles', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const mine = req.query.mine === '1';
  let rows = mine
    ? db.all('SELECT * FROM articles WHERE seller_id = ? AND is_active = 1 ORDER BY created_at DESC', req.user.id)
    : db.all('SELECT a.* FROM articles a JOIN users u ON u.id = a.seller_id WHERE a.is_active = 1 AND u.is_suspended = 0 ORDER BY a.created_at DESC LIMIT 200');
  if (q) {
    rows = rows.filter((a) => {
      const s = getUser(a.seller_id);
      return `${a.title} ${a.description} ${s.name} ${s.shop_name}`.toLowerCase().includes(q);
    });
  }
  res.json({ articles: rows.map((a) => articleView(a, req.user)) });
});

router.post('/articles', (req, res) => {
  const b = req.body || {};
  if (req.user.shop_lat == null) fail(400, "Placez d'abord votre boutique sur la carte : elle sert au calcul des frais de livraison.", 'shop');
  const title = v.text(b.title, { field: 'title', label: 'Le titre', min: 3, max: 80, required: true });
  const description = v.text(b.description, { field: 'description', label: 'La description', max: 500 });
  const priceSat = v.intIn(b.price_sat, { field: 'price_sat', label: 'Le prix (en sats)', min: 1000, max: config.articleMaxSat });
  const { id } = db.run('INSERT INTO articles (seller_id, title, description, price_sat, created_at) VALUES (?, ?, ?, ?, ?)', req.user.id, title, description, priceSat, now());
  db.audit(req.user.id, 'article.creation', `article:${id}`, { title, price_sat: priceSat }, req.ip);
  res.status(201).json({ article: articleView(db.one('SELECT * FROM articles WHERE id = ?', id), req.user) });
});

router.delete('/articles/:id', (req, res) => {
  const a = db.one('SELECT * FROM articles WHERE id = ?', v.idParam(req.params.id));
  if (!a || a.seller_id !== req.user.id) fail(404, 'Article introuvable.');
  db.update('articles', a.id, { is_active: 0, removed_reason: 'Retiré par le vendeur' });
  db.audit(req.user.id, 'article.retrait', `article:${a.id}`, null, req.ip);
  res.json({ ok: true });
});

router.post('/quote', async (req, res) => {
  const b = req.body || {};
  const article = activeArticle(b.article_id);
  const { lat, lng } = v.coords(b.lat, b.lng, 'delivery');
  const { seller, ...q } = await quote(article, lat, lng);
  res.json({ ...q, shop: { lat: seller.shop_lat, lng: seller.shop_lng, address: seller.shop_address } });
});

router.post('/orders', async (req, res) => {
  const b = req.body || {};
  const article = activeArticle(b.article_id);
  if (article.seller_id === req.user.id) fail(403, 'Vous ne pouvez pas acheter votre propre article.');
  const { lat, lng } = v.coords(b.lat, b.lng, 'delivery');
  const address = v.text(b.address, { field: 'address', label: "L'adresse de livraison", max: 200 });
  const itemHash = String(b.item_hash || '').toLowerCase();
  if (!isHex64(itemHash)) fail(400, 'Empreinte du code de livraison invalide (64 caractères hexadécimaux attendus).', 'item_hash');
  if (db.one('SELECT id FROM orders WHERE item_hash = ? OR fee_hash = ?', itemHash, itemHash)) fail(409, 'Ce code de livraison a déjà servi : générez-en un nouveau.', 'item_hash');

  const q = await quote(article, lat, lng);
  const expiry = config.invoiceExpiryMin * 60;
  // Facture A : nœud vendeur, hash fourni par l'acheteur.
  const A = await ln.call(ln.vendeur.addHoldInvoice(itemHash, q.item_sat, `Kaaraange · ${article.title} (article)`, expiry));
  // Facture B : nœud livreur, secret tiré par le serveur et gardé en base.
  const feePreimage = randomHex(32);
  const feeHash = sha256hex(Buffer.from(feePreimage, 'hex'));
  let B;
  try {
    B = await ln.call(ln.livreur.addHoldInvoice(feeHash, q.fee_sat, `Kaaraange · livraison de ${article.title}`, expiry));
  } catch (e) {
    await cancelInvoice(ln.vendeur, itemHash);
    throw e;
  }
  const { id } = db.run(
    `INSERT INTO orders (article_id, buyer_id, seller_id, title, item_sat, fee_sat, fee_xof, distance_km, btc_xof,
      shop_lat, shop_lng, shop_address, delivery_lat, delivery_lng, delivery_address, status,
      item_hash, item_request, fee_hash, fee_preimage, fee_request, invoice_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?, ?, ?, ?, ?, ?)`,
    article.id, req.user.id, article.seller_id, article.title, q.item_sat, q.fee_sat, q.fee_xof, q.distance_km, q.btc_xof,
    q.seller.shop_lat, q.seller.shop_lng, q.seller.shop_address, lat, lng, address,
    itemHash, A.request, feeHash, feePreimage, B.request, now() + expiry, now(),
  );
  db.audit(req.user.id, 'commande.creation', `order:${id}`, { article_id: article.id, item_sat: q.item_sat, fee_sat: q.fee_sat, distance_km: q.distance_km }, req.ip);
  res.status(201).json({ order: view(getOrder(id), req.user) });
});

router.get('/orders', (req, res) => {
  const scope = String(req.query.scope || 'buyer');
  const col = { buyer: 'buyer_id', seller: 'seller_id', courier: 'courier_id' }[scope];
  if (!col) fail(400, 'Paramètre scope invalide (buyer, seller ou courier).', 'scope');
  const rows = db.all(`SELECT * FROM orders WHERE ${col} = ? ORDER BY created_at DESC, id DESC LIMIT 100`, req.user.id);
  res.json({ orders: rows.map((o) => view(o, req.user)) });
});

router.get('/orders/:id', async (req, res) => {
  const o = await refresh(loadForUser(req, req.params.id));
  res.json({ order: view(o, req.user) });
});

/** Paiement de démonstration : le serveur pilote le nœud acheteur (alice). */
router.post('/orders/:id/pay', async (req, res) => {
  let o = loadForUser(req, req.params.id);
  if (o.buyer_id !== req.user.id) fail(403, "Seul l'acheteur peut payer cette commande.");
  o = await refresh(o);
  if (o.status !== 'awaiting_payment') fail(409, 'Cette commande est déjà payée ou close.');

  const errors = {};
  // Une hold invoice reste « en vol » jusqu'au settle/cancel : on n'attend pas ln.pay.
  const launch = (key, request) =>
    ln.acheteur.payAsync(request, (err) => {
      if (err) errors[key] = v.lnError(err).message;
    });
  if (o.item_state === 'OPEN') launch('item', o.item_request);
  if (o.fee_state === 'OPEN') launch('fee', o.fee_request);

  const until = Date.now() + 15000;
  for (;;) {
    await sleep(100);
    o = await refresh(getOrder(o.id));
    if (o.status !== 'awaiting_payment' || errors.item || errors.fee || Date.now() > until) break;
  }
  if (o.status === 'awaiting_payment' && (errors.item || errors.fee)) {
    const msg = errors.item || errors.fee;
    db.update('orders', o.id, { pay_error: msg });
    await cancelOrder(getOrder(o.id), 'paiement_echoue', req.user.id, 'commande.paiement_echoue');
    fail(502, `${msg} Les deux factures ont été annulées : aucun fonds n'est resté bloqué.`);
  }
  res.json({ order: view(o, req.user) });
});

router.post('/orders/:id/cancel', async (req, res) => {
  let o = loadForUser(req, req.params.id);
  if (o.buyer_id !== req.user.id && o.seller_id !== req.user.id) fail(403, 'Action non autorisée.');
  o = await refresh(o);
  if (o.status !== 'awaiting_payment') fail(409, "Annulation possible uniquement avant le paiement. Une fois payé, le remboursement est automatique en cas de problème.");
  o = await cancelOrder(o, o.buyer_id === req.user.id ? 'annulee_par_acheteur' : 'annulee_par_vendeur', req.user.id, 'commande.annulation');
  res.json({ order: view(o, req.user) });
});

function courierPosition(userId) {
  const c = db.one('SELECT lat, lng FROM couriers WHERE user_id = ?', userId);
  if (!c || c.lat == null) fail(400, 'Position inconnue : activez la localisation (GPS ou simulée).', 'position');
  return c;
}

router.post('/orders/:id/pickup', (req, res) => {
  const o = loadForUser(req, req.params.id);
  if (o.courier_id !== req.user.id) fail(403, 'Seul le livreur de la course peut récupérer le colis.');
  if (o.status !== 'assigned') fail(409, 'Le colis ne peut pas être récupéré à cette étape.');
  const c = courierPosition(req.user.id);
  const d = haversine(c.lat, c.lng, o.shop_lat, o.shop_lng);
  if (d > config.pickupRadiusKm) {
    fail(400, `Vous êtes à ${d.toFixed(2).replace('.', ',')} km de la boutique : approchez-vous à moins de ${String(config.pickupRadiusKm).replace('.', ',')} km pour récupérer le colis.`, 'position');
  }
  db.update('orders', o.id, { status: 'picked_up', picked_up_at: now() });
  db.audit(req.user.id, 'commande.retrait', `order:${o.id}`, { distance_km: round(d, 3) }, req.ip);
  res.json({ order: view(getOrder(o.id), req.user) });
});

/** Un seul scan, deux paiements : settle(A) avec le code du client, puis settle(B). */
router.post('/orders/:id/deliver', async (req, res) => {
  const o = loadForUser(req, req.params.id);
  const byCourier = o.courier_id === req.user.id;
  const byBuyer = o.buyer_id === req.user.id;
  if (!byCourier && !byBuyer) fail(403, 'Seuls le livreur et le client peuvent valider la remise.');
  if (o.status !== 'picked_up') fail(409, "Le colis n'est pas en cours de livraison.");
  const code = String((req.body || {}).code || '').trim().toLowerCase().replace(/^kaaraange:/, '').replace(/\s+/g, '');
  if (!isHex64(code)) fail(400, 'Code de livraison invalide : 64 caractères hexadécimaux attendus.', 'code');
  if (sha256hex(Buffer.from(code, 'hex')) !== o.item_hash) {
    db.audit(req.user.id, 'livraison.code_incorrect', `order:${o.id}`, null, req.ip);
    fail(400, 'Code de livraison incorrect : il ne correspond pas à la facture de cet article.', 'code');
  }
  await ln.call(ln.vendeur.settle(code));
  let feeError = null;
  try {
    await ln.livreur.settle(o.fee_preimage);
  } catch (e) {
    feeError = v.lnError(e).message; // nouvel essai automatique dans la boucle
  }
  db.update('orders', o.id, { status: 'delivered', delivered_at: now() });
  await syncStates(o);
  dispatch().freeCourier(o.courier_id, o.id);
  db.audit(req.user.id, 'commande.livree', `order:${o.id}`, { par: byCourier ? 'livreur' : 'acheteur', item_sat: o.item_sat, fee_sat: o.fee_sat, fee_error: feeError }, req.ip);
  res.json({ order: view(getOrder(o.id), req.user) });
});

router.post('/orders/:id/refuse', async (req, res) => {
  const o = loadForUser(req, req.params.id);
  if (o.buyer_id !== req.user.id) fail(403, 'Seul le client peut refuser le colis.');
  if (o.status !== 'picked_up') fail(409, 'Le refus est possible uniquement quand le livreur a le colis en main.');
  const b = req.body || {};
  if (!REFUSE_REASONS[b.reason]) fail(400, 'Choisissez un motif de refus.', 'reason');
  const comment = v.text(b.comment, { field: 'comment', label: 'Le commentaire', max: 300 });
  await ln.call(ln.vendeur.cancel(o.item_hash)); // le prix revient à l'acheteur, B reste bloquée
  db.update('orders', o.id, { status: 'returning', returning_at: now(), return_cause: 'refus', refuse_reason: b.reason, refuse_comment: comment });
  await syncStates(o);
  db.audit(req.user.id, 'commande.refus', `order:${o.id}`, { motif: b.reason }, req.ip);
  res.json({ order: view(getOrder(o.id), req.user) });
});

router.post('/orders/:id/absent', async (req, res) => {
  const o = loadForUser(req, req.params.id);
  if (o.courier_id !== req.user.id) fail(403, 'Seul le livreur de la course peut déclarer le client absent.');
  if (o.status !== 'picked_up') fail(409, "Le colis n'est pas en cours de livraison.");
  const c = courierPosition(req.user.id);
  const d = haversine(c.lat, c.lng, o.delivery_lat, o.delivery_lng);
  if (d > config.absentRadiusKm) {
    fail(400, `Vous êtes à ${d.toFixed(2).replace('.', ',')} km du point de livraison : présentez-vous sur place avant de déclarer le client absent.`, 'position');
  }
  await ln.call(ln.vendeur.cancel(o.item_hash));
  db.update('orders', o.id, { status: 'returning', returning_at: now(), return_cause: 'absent' });
  await syncStates(o);
  db.audit(req.user.id, 'commande.client_absent', `order:${o.id}`, { distance_km: round(d, 3) }, req.ip);
  res.json({ order: view(getOrder(o.id), req.user) });
});

router.post('/orders/:id/confirm-return', async (req, res) => {
  const o = loadForUser(req, req.params.id);
  if (o.seller_id !== req.user.id) fail(403, 'Seul le vendeur peut confirmer le retour du colis.');
  if (o.status !== 'returning') fail(409, "Aucun retour en cours pour cette commande.");
  await ln.call(ln.livreur.settle(o.fee_preimage)); // le livreur est payé pour son déplacement
  db.update('orders', o.id, { status: 'returned', returned_at: now() });
  await syncStates(o);
  dispatch().freeCourier(o.courier_id, o.id);
  db.audit(req.user.id, 'commande.retour_confirme', `order:${o.id}`, { fee_sat: o.fee_sat }, req.ip);
  res.json({ order: view(getOrder(o.id), req.user) });
});

router.post('/orders/:id/review', (req, res) => {
  const o = loadForUser(req, req.params.id);
  const b = req.body || {};
  const target = String(b.target || '');
  const rating = v.intIn(b.rating, { field: 'rating', label: 'La note', min: 1, max: 5 });
  const comment = v.text(b.comment, { field: 'comment', label: 'Le commentaire', max: 500 });
  let targetId;
  if (target === 'vendeur') {
    if (o.buyer_id !== req.user.id) fail(403, "Seul l'acheteur peut noter le vendeur.");
    if (o.status !== 'delivered') fail(400, 'Achat vérifié requis : vous pourrez noter le vendeur après la livraison.');
    targetId = o.seller_id;
  } else if (target === 'livreur') {
    if (o.buyer_id !== req.user.id) fail(403, "Seul l'acheteur peut noter le livreur.");
    if (!o.courier_id || !['delivered', 'returning', 'returned'].includes(o.status)) fail(400, 'Vous pourrez noter le livreur après son passage.');
    targetId = o.courier_id;
  } else if (target === 'client') {
    if (o.courier_id !== req.user.id) fail(403, 'Seul le livreur de la course peut noter le client.');
    if (!['delivered', 'returning', 'returned'].includes(o.status)) fail(400, 'Vous pourrez noter le client après la remise ou le retour.');
    targetId = o.buyer_id;
  } else fail(400, 'Cible inconnue : vendeur, livreur ou client.', 'target');
  if (db.one('SELECT id FROM reviews WHERE order_id = ? AND author_id = ? AND target_id = ?', o.id, req.user.id, targetId)) {
    fail(409, 'Vous avez déjà donné votre avis pour cette commande.');
  }
  db.run('INSERT INTO reviews (order_id, author_id, target_id, role, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', o.id, req.user.id, targetId, target, rating, comment, now());
  db.audit(req.user.id, 'avis.creation', `order:${o.id}`, { cible: target, note: rating }, req.ip);
  res.status(201).json({ ok: true, ratings: ratingsOf(targetId), order: view(getOrder(o.id), req.user) });
});

/** Tableau de bord de l'utilisateur connecté. */
router.get('/stats', (req, res) => {
  const id = req.user.id;
  const sum = (sql, ...p) => db.one(sql, ...p).s || 0;
  const esc = IN_ESCROW.map((s) => `'${s}'`).join(',');
  const stats = {
    locked_sat:
      sum(`SELECT SUM(item_sat + fee_sat) s FROM orders WHERE buyer_id = ? AND status IN (${esc})`, id) +
      sum("SELECT SUM(fee_sat) s FROM orders WHERE buyer_id = ? AND status = 'returning'", id),
    incoming_seller_sat: sum(`SELECT SUM(item_sat) s FROM orders WHERE seller_id = ? AND status IN (${esc})`, id),
    earned_seller_sat: sum("SELECT SUM(item_sat) s FROM orders WHERE seller_id = ? AND status = 'delivered' AND item_state = 'SETTLED'", id),
    courier_earned_sat: sum("SELECT SUM(fee_sat) s FROM orders WHERE courier_id = ? AND fee_state = 'SETTLED'", id),
    spent_sat:
      sum("SELECT SUM(item_sat + fee_sat) s FROM orders WHERE buyer_id = ? AND status = 'delivered'", id) +
      sum("SELECT SUM(fee_sat) s FROM orders WHERE buyer_id = ? AND status = 'returned' AND fee_state = 'SETTLED'", id),
    refunded_sat:
      sum("SELECT SUM(item_sat + fee_sat) s FROM orders WHERE buyer_id = ? AND status = 'canceled' AND paid_at IS NOT NULL", id) +
      sum("SELECT SUM(item_sat) s FROM orders WHERE buyer_id = ? AND status IN ('returning','returned')", id) +
      sum("SELECT SUM(fee_sat) s FROM orders WHERE buyer_id = ? AND (fee_refunded_at IS NOT NULL OR (status = 'returned' AND fee_state = 'CANCELED'))", id),
    counts: {
      purchases: db.one('SELECT COUNT(*) n FROM orders WHERE buyer_id = ?', id).n,
      sales: db.one("SELECT COUNT(*) n FROM orders WHERE seller_id = ? AND status <> 'awaiting_payment' AND status <> 'canceled'", id).n,
      deliveries: db.one("SELECT COUNT(*) n FROM orders WHERE courier_id = ? AND status = 'delivered'", id).n,
      articles: db.one('SELECT COUNT(*) n FROM articles WHERE seller_id = ? AND is_active = 1', id).n,
    },
  };
  const recent = db.all('SELECT * FROM orders WHERE buyer_id = ? OR seller_id = ? OR courier_id = ? ORDER BY COALESCE(delivered_at, returned_at, canceled_at, picked_up_at, assigned_at, paid_at, created_at) DESC LIMIT 8', id, id, id);
  res.json({ stats, recent: recent.map((o) => view(o, req.user)) });
});

module.exports = {
  router,
  tick,
  refresh,
  view,
  getOrder,
  articleView,
  adminRefund,
  adminFee,
  adminRefundFee,
  cancelOrder,
  REFUSE_REASONS,
  IN_ESCROW,
  OPEN_STATUSES,
};
