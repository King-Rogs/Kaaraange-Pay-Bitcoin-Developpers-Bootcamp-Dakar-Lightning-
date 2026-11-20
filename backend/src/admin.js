'use strict';
/**
 * Espace administrateur. Toutes les routes passent par requireAdmin :
 * 401 sans session, 403 pour un utilisateur normal.
 */
const express = require('express');
const config = require('./config');
const db = require('./db');
const ln = require('./lightning');
const bitcoin = require('./bitcoin');
const price = require('./price');
const orders = require('./orders');
const dispatch = require('./dispatch');
const v = require('./util');
const { requireAdmin, publicUser, ratingsOf } = require('./auth');
const { nodeSnapshot, walletName } = require('./chain');
const { fail, now } = v;
const { alerts } = require('./alerts');
const { serviceRating } = require('./courier-metrics');

const router = express.Router();
router.use('/admin', requireAdmin);
router.get('/admin/alerts', (_req, res) => res.json({ alerts: alerts() }));

const DAY = 86400;
const esc = orders.IN_ESCROW.map((s) => `'${s}'`).join(',');
const sum = (sql, ...p) => db.one(sql, ...p).s || 0;

router.get('/admin/stats', (_req, res) => {
  const t = now();
  const byStatus = Object.fromEntries(db.all('SELECT status, COUNT(*) n FROM orders GROUP BY status').map((r) => [r.status, r.n]));
  const expiring = db.all(`SELECT * FROM orders WHERE status IN (${esc}) AND deadline_at < ? ORDER BY deadline_at`, t + 30 * 60);

  const start = Math.floor(t / DAY) * DAY - 13 * DAY;
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const d0 = start + i * DAY;
    days.push({
      date: new Date(d0 * 1000).toISOString().slice(0, 10),
      orders: db.one('SELECT COUNT(*) n FROM orders WHERE created_at >= ? AND created_at < ?', d0, d0 + DAY).n,
      delivered: db.one('SELECT COUNT(*) n FROM orders WHERE delivered_at >= ? AND delivered_at < ?', d0, d0 + DAY).n,
      volume_sat: sum('SELECT SUM(item_sat + fee_sat) s FROM orders WHERE paid_at >= ? AND paid_at < ?', d0, d0 + DAY),
    });
  }

  res.json({
    alerts: alerts(),
    users: {
      total: db.one('SELECT COUNT(*) n FROM users WHERE is_bot = 0').n,
      active_7d: db.one('SELECT COUNT(*) n FROM users WHERE is_bot = 0 AND last_seen_at >= ?', t - 7 * DAY).n,
      suspended: db.one('SELECT COUNT(*) n FROM users WHERE is_suspended = 1').n,
      admins: db.one('SELECT COUNT(*) n FROM users WHERE is_admin = 1').n,
      bots: db.one('SELECT COUNT(*) n FROM users WHERE is_bot = 1').n,
    },
    couriers: {
      online: db.one("SELECT COUNT(*) n FROM couriers WHERE status = 'available'").n,
      busy: db.one("SELECT COUNT(*) n FROM couriers WHERE status = 'busy'").n,
    },
    orders: { total: db.one('SELECT COUNT(*) n FROM orders').n, by_status: byStatus },
    locked_sat: sum("SELECT SUM(CASE WHEN item_state = 'ACCEPTED' THEN item_sat ELSE 0 END + CASE WHEN fee_state = 'ACCEPTED' THEN fee_sat ELSE 0 END) s FROM orders"),
    paid_sellers_sat: sum("SELECT SUM(item_sat) s FROM orders WHERE status = 'delivered' AND item_state = 'SETTLED'"),
    paid_couriers_sat: sum("SELECT SUM(fee_sat) s FROM orders WHERE fee_state = 'SETTLED'"),
    returns_in_progress: byStatus.returning || 0,
    expiring_soon: expiring.map((o) => ({ id: o.id, title: o.title, status: o.status, deadline_at: o.deadline_at, total_sat: o.item_sat + o.fee_sat })),
    activity_14d: days,
  });
});

function userRows(q) {
  const like = `%${q}%`;
  const rows = db.all(
    `SELECT u.*,
       (SELECT COUNT(*) FROM orders o WHERE o.seller_id = u.id AND o.paid_at IS NOT NULL) AS sales,
       (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) AS purchases,
       (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id AND o.return_cause = 'refus') AS refusals,
       (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id AND o.return_cause = 'absent') AS absences,
       (SELECT COUNT(*) FROM orders o WHERE o.courier_id = u.id AND o.status = 'delivered') AS deliveries
     FROM users u WHERE (? = '' OR u.name LIKE ? OR u.email LIKE ? OR u.shop_name LIKE ?)
     ORDER BY u.is_bot, u.created_at DESC LIMIT 500`,
    q,
    like,
    like,
    like,
  );
  return rows.map((u) => ({
    ...publicUser(u),
    email: u.email,
    phone: u.phone,
    is_admin: !!u.is_admin,
    is_suspended: !!u.is_suspended,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
    ratings: ratingsOf(u.id),
    courier_service: serviceRating(u.id),
    sales: u.sales,
    purchases: u.purchases,
    refusals: u.refusals,
    absences: u.absences,
    deliveries: u.deliveries,
  }));
}

/** Solde disponible (sats) du portefeuille regtest de l'utilisateur, 0 si pas encore créé. */
async function walletBalance(userId) {
  try {
    const name = walletName({ id: userId });
    if (!(await bitcoin.chain.walletExists(name))) return 0;
    return (await bitcoin.chain.walletInfo(name)).balances.trusted_sat;
  } catch {
    return 0;
  }
}

async function withWalletBalance(users) {
  return Promise.all(users.map(async (u) => ({ ...u, wallet_sat: await walletBalance(u.id) })));
}

const csvCell = (x) => {
  const s = x == null ? '' : String(x);
  // Neutralise les formules (injection CSV) et échappe les guillemets.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

router.get('/admin/users', async (req, res) => {
  const users = await withWalletBalance(userRows(String(req.query.q || '').trim()));
  if (req.query.format === 'csv') {
    const head = ['id', 'nom', 'email', 'telephone', 'boutique', 'admin', 'suspendu', 'bot', 'inscrit_le', 'solde_disponible_sat', 'note_vendeur', 'note_livreur', 'note_client', 'ventes', 'achats', 'refus', 'absences', 'livraisons'];
    const lines = users.map((u) =>
      [u.id, u.name, u.email, u.phone, u.shop_name, u.is_admin ? 'oui' : 'non', u.is_suspended ? 'oui' : 'non', u.is_bot ? 'oui' : 'non', new Date(u.created_at * 1000).toISOString(),
        u.wallet_sat, u.ratings.vendeur.avg ?? '', u.ratings.livreur.avg ?? '', u.ratings.client.avg ?? '', u.sales, u.purchases, u.refusals, u.absences, u.deliveries]
        .map(csvCell)
        .join(';'),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kaaraange-utilisateurs.csv"');
    return res.send(`﻿${[head.join(';'), ...lines].join('\r\n')}`);
  }
  return res.json({ users });
});

router.patch('/admin/users/:id', async (req, res) => {
  const id = v.idParam(req.params.id);
  if (id === req.user.id) fail(403, 'Vous ne pouvez pas modifier votre propre compte depuis l’administration.');
  const u = db.one('SELECT * FROM users WHERE id = ?', id);
  if (!u) fail(404, 'Utilisateur introuvable.');
  const b = req.body || {};
  const fields = {};
  if (b.is_suspended !== undefined) fields.is_suspended = b.is_suspended ? 1 : 0;
  if (b.is_admin !== undefined) {
    if (u.is_bot) fail(400, 'Un livreur simulé ne peut pas être administrateur.');
    fields.is_admin = b.is_admin ? 1 : 0;
  }
  if (!Object.keys(fields).length) fail(400, 'Aucune modification demandée.');
  db.update('users', id, fields);
  if (fields.is_suspended === 1) {
    // Suspension immédiate : toutes les sessions sont supprimées, le livreur passe hors ligne.
    db.run('DELETE FROM sessions WHERE user_id = ?', id);
    db.run("UPDATE couriers SET status = 'offline' WHERE user_id = ? AND status = 'available'", id);
    db.run("UPDATE offers SET status = 'canceled', responded_at = ? WHERE courier_id = ? AND status = 'pending'", now(), id);
  }
  const action = fields.is_suspended === 1 ? 'admin.suspension' : fields.is_suspended === 0 ? 'admin.reactivation' : fields.is_admin ? 'admin.nomination' : 'admin.retrait_admin';
  db.audit(req.user.id, action, `user:${id}`, fields, req.ip);
  const [user] = await withWalletBalance([userRows('').find((x) => x.id === id)]);
  res.json({ user });
});

router.get('/admin/orders', async (req, res) => {
  const status = String(req.query.status || '');
  const rows = status
    ? db.all('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 300', status)
    : db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 300');
  res.json({ orders: rows.map((o) => orders.view(o, req.user)) });
});

function adminOrder(id) {
  const o = orders.getOrder(v.idParam(id));
  if (!o) fail(404, 'Commande introuvable.');
  return o;
}

router.post('/admin/orders/:id/refund', async (req, res) => {
  const reason = v.text((req.body || {}).reason, { field: 'reason', label: 'Le motif', min: 3, max: 200, required: true });
  const o = await orders.adminRefund(await orders.refresh(adminOrder(req.params.id)), reason, req.user.id);
  const order = orders.view(o, req.user);
  res.status(order.financial_pending ? 202 : 200).json({ order });
});

router.post('/admin/orders/:id/fee', async (req, res) => {
  const o = await orders.adminFee(adminOrder(req.params.id), String((req.body || {}).action || ''), req.user.id, (req.body || {}).reason);
  const order = orders.view(o, req.user);
  res.status(order.financial_pending ? 202 : 200).json({ order });
});

router.post('/admin/orders/:id/refund-fee', async (req, res) => {
  const r = await orders.adminRefundFee(adminOrder(req.params.id), req.user.id);
  res.json({ order: orders.view(r.order, req.user), payment: r.payment });
});

router.get('/admin/articles', (req, res) => {
  const rows = db.all('SELECT * FROM articles ORDER BY is_active DESC, created_at DESC LIMIT 500');
  res.json({ articles: rows.map((a) => orders.articleView(a, req.user)) });
});

router.delete('/admin/articles/:id', (req, res) => {
  const a = db.one('SELECT * FROM articles WHERE id = ?', v.idParam(req.params.id));
  if (!a) fail(404, 'Article introuvable.');
  const reason = v.text((req.body || {}).reason ?? req.query.reason, { field: 'reason', label: 'Le motif', min: 3, max: 200, required: true });
  db.update('articles', a.id, { is_active: 0, removed_reason: reason, removed_by_admin: 1 });
  db.audit(req.user.id, 'admin.retrait_article', `article:${a.id}`, { motif: reason, vendeur: a.seller_id }, req.ip);
  res.json({ ok: true });
});

router.get('/admin/dispatch', (_req, res) => res.json(dispatch.adminSnapshot()));

router.get('/admin/system', async (_req, res) => {
  const [nodes, btc, p] = await Promise.all([Promise.all(ln.all.map(nodeSnapshot)), bitcoin.chain.health(), price.get()]);
  res.json({
    modes: { LND_MODE: config.lndMode, BTC_MODE: config.btcMode, SIMULATION: config.simulation, DEV_MODE: config.devMode, PRICE_MODE: config.priceMode },
    nodes: nodes.map((n) => ({
      id: n.id,
      role: n.role,
      mode: n.mode,
      reachable: n.reachable,
      error: n.error || null,
      alias: n.info?.alias,
      public_key: n.info?.public_key,
      block_height: n.info?.block_height,
      synced: n.info?.synced,
      version: n.info?.version,
      channels: n.channels?.length ?? 0,
      local_sat: n.balances?.offchain_local_sat ?? null,
    })),
    bitcoind: { mode: config.btcMode, url: config.btcMode === 'rpc' ? config.btcRpc.url : 'simulation', ...btc },
    price: { btc_xof: Math.round(p.btc_xof), source: p.source, updated_at: p.updated_at },
    settings: {
      ROAD_FACTOR: config.roadFactor,
      FEE_BASE_XOF: config.feeBaseXof,
      FEE_PER_KM_XOF: config.feePerKmXof,
      DEADLINE_MIN: config.deadlineMin,
      RETURN_DEADLINE_MIN: config.returnDeadlineMin,
      HOLD_CLTV_DELTA: config.holdCltvDelta,
      RECOVERY_RETRY_SEC: config.recoveryRetrySec,
      LOW_RATING_THRESHOLD: config.lowRatingThreshold,
      INVOICE_EXPIRY_MIN: config.invoiceExpiryMin,
      PICKUP_RADIUS_KM: config.pickupRadiusKm,
      ABSENT_RADIUS_KM: config.absentRadiusKm,
      OFFER_SECONDS: config.offerSeconds,
      SIM_BOTS: config.simBots,
      SIM_STEP_KM: config.simStepKm,
      ARTICLE_MAX_SAT: config.articleMaxSat,
    },
    server: { node: process.version, uptime_s: Math.round(process.uptime()) },
  });
});

router.get('/admin/audit', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const like = `%${q}%`;
  const rows = db.all(
    `SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit a LEFT JOIN users u ON u.id = a.user_id
     WHERE (? = '' OR a.action LIKE ? OR a.target LIKE ? OR u.name LIKE ? OR u.email LIKE ?)
     ORDER BY a.id DESC LIMIT ?`,
    q,
    like,
    like,
    like,
    like,
    limit,
  );
  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      target: r.target,
      details: r.details ? JSON.parse(r.details) : null,
      ip: r.ip,
      user: r.user_id ? { id: r.user_id, name: r.user_name, email: r.user_email } : null,
    })),
  });
});

module.exports = { router };
