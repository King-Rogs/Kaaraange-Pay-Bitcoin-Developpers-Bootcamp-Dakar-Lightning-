'use strict';
const db = require('./db');
const config = require('./config');
const { now, round } = require('./util');
const { serviceRating } = require('./courier-metrics');

function alerts() {
  const list = [];
  for (const row of db.all('SELECT r.target_id, r.role, AVG(r.rating) avg, COUNT(*) count, u.name FROM reviews r JOIN users u ON u.id = r.target_id WHERE u.is_suspended = 0 GROUP BY r.target_id, r.role HAVING AVG(r.rating) < ?', config.lowRatingThreshold)) {
    list.push({ id: `rating:${row.target_id}:${row.role}`, type: 'low_rating', severity: 'warning', user_id: row.target_id, title: `${row.name} : note ${row.role} faible`, detail: `${round(row.avg, 1)}/5 sur ${row.count} avis`, path: '/app/admin/utilisateurs' });
  }
  for (const c of db.all('SELECT DISTINCT i.courier_id, u.name FROM courier_incidents i JOIN users u ON u.id = i.courier_id WHERE u.is_suspended = 0')) {
    const service = serviceRating(c.courier_id);
    if (service.missed_deliveries || service.abandonments >= 2 || service.late_returns) list.push({ id: `courier:${c.courier_id}`, type: 'courier_incident', severity: 'warning', user_id: c.courier_id, title: `${c.name} : incident de livraison`, detail: `${service.missed_deliveries} non-présentation(s), ${service.abandonments} abandon(s), ${service.late_returns} retour(s) en retard. Note de service : ${service.score}/5.`, path: '/app/admin/dispatch' });
  }
  for (const o of db.all("SELECT id, title FROM orders WHERE status = 'returning' AND return_deadline_at < ?", now())) list.push({ id: `return:${o.id}`, type: 'return_overdue', severity: 'critical', order_id: o.id, title: `Retour à arbitrer : ${o.title}`, detail: 'Le délai de retour est dépassé. Vérifier le colis et décider du paiement avant expiration des HTLC.', path: '/app/admin/commandes' });
  for (const a of db.all('SELECT a.order_id, a.kind, a.error FROM order_actions a WHERE a.error IS NOT NULL')) list.push({ id: `payment:${a.order_id}`, type: 'payment_pending', severity: 'critical', order_id: a.order_id, title: `Confirmation financière en attente : commande ${a.order_id}`, detail: a.error, path: '/app/admin/commandes' });
  for (const o of db.all("SELECT id, fee_refund_error FROM orders WHERE status = 'returned' AND return_cause IN ('refus','vendeur') AND fee_state = 'SETTLED' AND fee_refunded_at IS NULL")) list.push({ id: `refund:${o.id}`, type: 'refund_pending', severity: 'warning', order_id: o.id, title: `Remboursement vendeur en attente : commande ${o.id}`, detail: o.fee_refund_error || 'Nouvelle tentative automatique programmée.', path: '/app/admin/commandes' });
  return list;
}
module.exports = { alerts };
