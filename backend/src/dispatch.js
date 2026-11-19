'use strict';
/**
 * Livreurs : statut, position, offres et attribution automatique,
 * comme dans une application de transport.
 *
 * À chaque tour (2 s), pour chaque commande en recherche de livreur sans offre
 * en attente, on choisit le candidat le moins coûteux :
 *   coût = distance(livreur, boutique)
 *        + pénalité de note ((5 − moyenne) × 0,6, ou 0,4 sans note)
 *        + (1 − taux d'acceptation) × 2
 * Il reçoit une offre de 30 s. Refusée ou expirée, elle passe au suivant ;
 * quand tout le monde a été sollicité, un nouveau tour commence.
 * Un livreur « busy » ne reçoit aucune offre tant que sa course n'est pas finie.
 */
const express = require('express');
const config = require('./config');
const db = require('./db');
const v = require('./util');
const { requireAuth, ratingsOf, publicUser } = require('./auth');
const { fail, now, haversine, moveToward, DAKAR, round } = v;

const orders = () => require('./orders'); // import différé (dépendance circulaire)

const BOT_NAMES = ['Modou', 'Aïssatou', 'Cheikh', 'Ndèye', 'Ousmane', 'Khady', 'Babacar', 'Mariama', 'Pape', 'Coumba'];
const DAKAR_BOX = { minLat: 14.665, maxLat: 14.79, minLng: -17.53, maxLng: -17.405 };

/* ---------- Livreurs ---------- */

function ensureCourier(userId) {
  let c = db.one('SELECT * FROM couriers WHERE user_id = ?', userId);
  if (!c) {
    db.run("INSERT INTO couriers (user_id, status, mode, updated_at) VALUES (?, 'offline', 'sim', ?)", userId, now());
    c = db.one('SELECT * FROM couriers WHERE user_id = ?', userId);
  }
  return c;
}

const acceptanceRate = (c) => (c.offers_received ? c.offers_accepted / c.offers_received : 1);

function costOf(c, shop) {
  const distance = haversine(c.lat, c.lng, shop.lat, shop.lng);
  const r = ratingsOf(c.user_id).livreur;
  const ratingPenalty = r.count ? (5 - r.avg) * 0.6 : 0.4;
  const reliability = (1 - acceptanceRate(c)) * 2;
  return { cost: round(distance + ratingPenalty + reliability, 3), distance: round(distance, 3) };
}

/** Libère le livreur à la fin d'une course (livrée, retournée ou annulée). */
function freeCourier(userId, orderId) {
  if (!userId) return;
  db.run("UPDATE couriers SET status = 'available', current_order_id = NULL, updated_at = ? WHERE user_id = ? AND status = 'busy' AND (current_order_id = ? OR current_order_id IS NULL)", now(), userId, orderId);
}

function courierView(c) {
  return {
    status: c.status,
    mode: c.mode,
    position: c.lat == null ? null : { lat: c.lat, lng: c.lng, at: c.location_at },
    current_order_id: c.current_order_id,
    offers_received: c.offers_received,
    offers_accepted: c.offers_accepted,
    acceptance_rate: round(acceptanceRate(c), 3),
    rating: ratingsOf(c.user_id).livreur,
  };
}

function offerView(f) {
  const o = orders().getOrder(f.order_id);
  return {
    id: f.id,
    order_id: f.order_id,
    status: f.status,
    round: f.round,
    cost: f.cost,
    distance_to_shop_km: f.distance_km,
    created_at: f.created_at,
    expires_at: f.expires_at,
    seconds_left: Math.max(0, f.expires_at - now()),
    order: o && {
      title: o.title,
      fee_sat: o.fee_sat,
      fee_xof: o.fee_xof,
      distance_km: o.distance_km,
      shop: { lat: o.shop_lat, lng: o.shop_lng, address: o.shop_address },
      delivery: { lat: o.delivery_lat, lng: o.delivery_lng, address: o.delivery_address },
    },
  };
}

/* ---------- Attribution ---------- */

function expireOffers() {
  for (const f of db.all("SELECT * FROM offers WHERE status = 'pending' AND expires_at <= ?", now())) {
    db.update('offers', f.id, { status: 'expired', responded_at: now() });
    db.audit(f.courier_id, 'offre.expiree', `order:${f.order_id}`, { offre: f.id });
  }
}

function candidatesFor(o) {
  return db.all(
    `SELECT c.* FROM couriers c JOIN users u ON u.id = c.user_id
     WHERE c.status = 'available' AND u.is_suspended = 0 AND c.lat IS NOT NULL
       AND c.user_id NOT IN (?, ?)
       AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.courier_id = c.user_id AND f.status = 'pending')`,
    o.buyer_id,
    o.seller_id,
  );
}

function assignOffers() {
  const waiting = db.all(
    `SELECT * FROM orders o WHERE status = 'searching_courier'
       AND NOT EXISTS (SELECT 1 FROM offers f WHERE f.order_id = o.id AND f.status = 'pending')
     ORDER BY paid_at, id`,
  );
  for (let o of waiting) {
    const all = candidatesFor(o);
    if (!all.length) continue;
    const asked = new Set(db.all('SELECT courier_id FROM offers WHERE order_id = ? AND round = ?', o.id, o.dispatch_round).map((r) => r.courier_id));
    let pool = all.filter((c) => !asked.has(c.user_id));
    if (!pool.length) {
      // Tout le monde a été sollicité : nouveau tour.
      db.update('orders', o.id, { dispatch_round: o.dispatch_round + 1 });
      o = orders().getOrder(o.id);
      pool = all;
    }
    const shop = { lat: o.shop_lat, lng: o.shop_lng };
    const best = pool.map((c) => ({ c, ...costOf(c, shop) })).sort((a, b) => a.cost - b.cost || a.distance - b.distance)[0];
    db.tx(() => {
      db.run(
        "INSERT INTO offers (order_id, courier_id, round, cost, distance_km, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        o.id,
        best.c.user_id,
        o.dispatch_round,
        best.cost,
        best.distance,
        now(),
        now() + config.offerSeconds,
      );
      db.run('UPDATE couriers SET offers_received = offers_received + 1 WHERE user_id = ?', best.c.user_id);
    });
  }
}

function acceptOffer(userId, offerId, ip) {
  const f = db.one('SELECT * FROM offers WHERE id = ? AND courier_id = ?', offerId, userId);
  if (!f) fail(404, 'Offre introuvable.');
  if (f.status !== 'pending') fail(409, 'Cette offre n’est plus disponible.');
  if (f.expires_at <= now()) {
    db.update('offers', f.id, { status: 'expired', responded_at: now() });
    fail(409, 'Offre expirée : elle a été proposée à un autre livreur.');
  }
  const c = ensureCourier(userId);
  if (c.status !== 'available') fail(409, 'Vous devez être en ligne et disponible pour accepter une course.');
  const o = orders().getOrder(f.order_id);
  if (!o || o.status !== 'searching_courier') {
    db.update('offers', f.id, { status: 'canceled', responded_at: now() });
    fail(409, 'Cette commande n’attend plus de livreur.');
  }
  db.tx(() => {
    db.update('offers', f.id, { status: 'accepted', responded_at: now() });
    db.run("UPDATE offers SET status = 'canceled', responded_at = ? WHERE order_id = ? AND status = 'pending' AND id <> ?", now(), o.id, f.id);
    db.update('orders', o.id, { status: 'assigned', courier_id: userId, assigned_at: now() });
    db.run("UPDATE couriers SET status = 'busy', current_order_id = ?, offers_accepted = offers_accepted + 1, updated_at = ? WHERE user_id = ?", o.id, now(), userId);
  });
  db.audit(userId, 'offre.acceptee', `order:${o.id}`, { offre: f.id, cout: f.cost, distance_km: f.distance_km }, ip);
  return orders().getOrder(o.id);
}

function declineOffer(userId, offerId, ip) {
  const f = db.one('SELECT * FROM offers WHERE id = ? AND courier_id = ?', offerId, userId);
  if (!f) fail(404, 'Offre introuvable.');
  if (f.status !== 'pending') fail(409, 'Cette offre n’est plus disponible.');
  db.update('offers', f.id, { status: 'declined', responded_at: now() });
  db.audit(userId, 'offre.refusee', `order:${f.order_id}`, { offre: f.id }, ip);
}

/* ---------- Simulation ---------- */

const jitter = (km) => (Math.random() - 0.5) * 2 * (km / 111);

function seedBots(count = config.simBots) {
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const email = `livreur${i + 1}@bots.kaaraange.local`;
    let u = db.one('SELECT * FROM users WHERE email = ?', email);
    if (!u) {
      const name = `${BOT_NAMES[i % BOT_NAMES.length]} (livreur simulé)`;
      // Mot de passe impossible : un livreur fictif ne peut pas se connecter.
      const { id } = db.run('INSERT INTO users (email, name, password_hash, is_bot, created_at) VALUES (?, ?, ?, 1, ?)', email, name, '!bot', now());
      u = db.one('SELECT * FROM users WHERE id = ?', id);
      created.push(u.id);
    }
    const c = ensureCourier(u.id);
    if (c.status === 'offline' || c.lat == null) {
      const spot = DAKAR[i % DAKAR.length];
      db.update('couriers', u.id, { status: 'available', mode: 'sim', lat: spot.lat + jitter(0.8), lng: spot.lng + jitter(0.8), location_at: now(), updated_at: now() }, 'user_id');
    }
  }
  return created;
}

function botsRespond() {
  const pending = db.all(
    "SELECT f.* FROM offers f JOIN users u ON u.id = f.courier_id WHERE f.status = 'pending' AND u.is_bot = 1 AND f.created_at <= ?",
    now() - config.simAcceptDelaySec,
  );
  for (const f of pending) {
    try {
      if (Math.random() < config.simAcceptRate) acceptOffer(f.courier_id, f.id, null);
      else declineOffer(f.courier_id, f.id, null);
    } catch {
      /* offre devenue caduque entre-temps */
    }
  }
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Fait avancer les livreurs en mode simulé (0,25 km toutes les 2 s). */
function moveSim() {
  const sims = db.all("SELECT c.*, u.is_bot FROM couriers c JOIN users u ON u.id = c.user_id WHERE c.mode = 'sim' AND c.status <> 'offline' AND c.lat IS NOT NULL");
  for (const c of sims) {
    if (c.status === 'busy' && c.current_order_id) {
      const o = orders().getOrder(c.current_order_id);
      if (!o) continue;
      let target = null;
      if (o.status === 'assigned' || o.status === 'returning') target = { lat: o.shop_lat, lng: o.shop_lng };
      else if (o.status === 'picked_up') target = { lat: o.delivery_lat, lng: o.delivery_lng };
      if (!target) continue;
      const p = moveToward(c, target, config.simStepKm);
      db.update('couriers', c.user_id, { lat: p.lat, lng: p.lng, location_at: now() }, 'user_id');
      // Un livreur fictif arrivé à la boutique récupère le colis tout seul.
      if (c.is_bot && p.arrived && o.status === 'assigned') {
        db.update('orders', o.id, { status: 'picked_up', picked_up_at: now() });
        db.audit(c.user_id, 'commande.retrait', `order:${o.id}`, { simulation: true });
      }
    } else if (c.is_bot && c.status === 'available') {
      // Flânerie : petit déplacement aléatoire pour que la carte vive.
      const step = 0.03 + Math.random() * 0.06;
      const angle = Math.random() * Math.PI * 2;
      const lat = clamp(c.lat + (Math.sin(angle) * step) / 111, DAKAR_BOX.minLat, DAKAR_BOX.maxLat);
      const lng = clamp(c.lng + (Math.cos(angle) * step) / 108, DAKAR_BOX.minLng, DAKAR_BOX.maxLng);
      db.update('couriers', c.user_id, { lat, lng, location_at: now() }, 'user_id');
    }
  }
}

function tick() {
  expireOffers();
  botsRespond();
  assignOffers();
  moveSim();
}

/* ---------- Routes ---------- */

const router = express.Router();
router.use('/courier', requireAuth);

router.get('/courier/me', (req, res) => {
  const c = ensureCourier(req.user.id);
  const f = db.one("SELECT * FROM offers WHERE courier_id = ? AND status = 'pending' AND expires_at > ? ORDER BY id DESC LIMIT 1", req.user.id, now());
  const current = c.current_order_id ? orders().getOrder(c.current_order_id) : null;
  const history = db.all('SELECT * FROM orders WHERE courier_id = ? ORDER BY assigned_at DESC LIMIT 30', req.user.id);
  const earned = db.one("SELECT COALESCE(SUM(fee_sat), 0) s FROM orders WHERE courier_id = ? AND fee_state = 'SETTLED'", req.user.id).s;
  res.json({
    courier: courierView(c),
    offer: f ? offerView(f) : null,
    current: current ? orders().view(current, req.user) : null,
    history: history.map((o) => orders().view(o, req.user)),
    earnings_sat: earned,
    radius_km: { pickup: config.pickupRadiusKm, absent: config.absentRadiusKm },
  });
});

router.post('/courier/status', (req, res) => {
  const b = req.body || {};
  const c = ensureCourier(req.user.id);
  const fields = { updated_at: now() };
  if (b.mode !== undefined) {
    if (!['gps', 'sim'].includes(b.mode)) fail(400, 'Mode de position inconnu (gps ou sim).', 'mode');
    fields.mode = b.mode;
  }
  if (b.lat !== undefined || b.lng !== undefined) {
    const p = v.coords(b.lat, b.lng);
    Object.assign(fields, { lat: p.lat, lng: p.lng, location_at: now() });
  }
  if (b.status !== undefined) {
    const status = b.status === 'online' ? 'available' : b.status;
    if (!['available', 'offline'].includes(status)) fail(400, 'Statut inconnu (available ou offline).', 'status');
    if (c.status === 'busy') {
      if (status === 'offline') fail(409, 'Impossible de passer hors ligne pendant une course : terminez-la d’abord.');
    } else {
      fields.status = status;
      if (status === 'offline') {
        db.run("UPDATE offers SET status = 'declined', responded_at = ? WHERE courier_id = ? AND status = 'pending'", now(), req.user.id);
      }
      if (status === 'available' && c.lat == null && fields.lat == null && (fields.mode || c.mode) === 'sim') {
        const spot = DAKAR[Math.floor(Math.random() * DAKAR.length)];
        Object.assign(fields, { lat: spot.lat + jitter(0.5), lng: spot.lng + jitter(0.5), location_at: now() });
      }
    }
    if (fields.status && fields.status !== c.status) db.audit(req.user.id, fields.status === 'available' ? 'livreur.en_ligne' : 'livreur.hors_ligne', `user:${req.user.id}`, null, req.ip);
  }
  db.update('couriers', req.user.id, fields, 'user_id');
  res.json({ courier: courierView(ensureCourier(req.user.id)) });
});

router.post('/courier/location', (req, res) => {
  const b = req.body || {};
  const p = v.coords(b.lat, b.lng);
  ensureCourier(req.user.id);
  db.update('couriers', req.user.id, { lat: p.lat, lng: p.lng, location_at: now(), updated_at: now() }, 'user_id');
  res.json({ ok: true, position: { ...p, at: now() } });
});

router.post('/courier/offers/:id/accept', (req, res) => {
  const o = acceptOffer(req.user.id, v.idParam(req.params.id), req.ip);
  res.json({ order: orders().view(o, req.user) });
});

router.post('/courier/offers/:id/decline', (req, res) => {
  declineOffer(req.user.id, v.idParam(req.params.id), req.ip);
  res.json({ ok: true });
});

/** Vue d'ensemble pour l'admin (carte de tous les livreurs + journal des offres). */
function adminSnapshot() {
  const couriers = db.all('SELECT c.*, u.name, u.avatar, u.is_bot, u.is_suspended, u.is_demo FROM couriers c JOIN users u ON u.id = c.user_id ORDER BY c.status, u.name');
  const offers = db.all(
    `SELECT f.*, u.name AS courier_name, o.title FROM offers f JOIN users u ON u.id = f.courier_id JOIN orders o ON o.id = f.order_id
     ORDER BY f.id DESC LIMIT 60`,
  );
  const active = db.all("SELECT * FROM orders WHERE status IN ('searching_courier','assigned','picked_up','returning') ORDER BY id DESC");
  return {
    couriers: couriers.map((c) => ({
      user: publicUser({ id: c.user_id, name: c.name, avatar: c.avatar, is_bot: c.is_bot, is_demo: c.is_demo, shop_name: '' }),
      is_suspended: !!c.is_suspended,
      ...courierView(c),
    })),
    orders: active.map((o) => ({
      id: o.id,
      title: o.title,
      status: o.status,
      courier_id: o.courier_id,
      dispatch_round: o.dispatch_round,
      shop: { lat: o.shop_lat, lng: o.shop_lng },
      delivery: { lat: o.delivery_lat, lng: o.delivery_lng },
      deadline_at: o.deadline_at,
    })),
    offers: offers.map((f) => ({
      id: f.id,
      order_id: f.order_id,
      title: f.title,
      courier_id: f.courier_id,
      courier_name: f.courier_name,
      round: f.round,
      cost: f.cost,
      distance_km: f.distance_km,
      status: f.status,
      created_at: f.created_at,
      responded_at: f.responded_at,
    })),
  };
}

module.exports = { router, tick, seedBots, freeCourier, ensureCourier, costOf, adminSnapshot, expireOffers, assignOffers, moveSim };
