'use strict';
const db = require('./db');
const { now, round } = require('./util');

function serviceRating(userId) {
  const reviews = db.one("SELECT AVG(rating) avg, COUNT(*) count FROM reviews WHERE target_id = ? AND role = 'livreur'", userId);
  const rows = db.all('SELECT kind, COUNT(*) count FROM courier_incidents WHERE courier_id = ? GROUP BY kind', userId);
  const incidents = Object.fromEntries(rows.map(r => [r.kind, r.count]));
  const missed = incidents.no_show || 0;
  const abandoned = incidents.abandon || 0;
  const late = incidents.late_return || 0;
  return { score: round(Math.max(1, (reviews.avg || 5) - missed * 0.5 - abandoned * 0.25 - late * 0.25), 1), missed_deliveries: missed, abandonments: abandoned, late_returns: late, reviews_count: reviews.count };
}

function incident(orderId, courierId, kind, reason = '') {
  if (!courierId) return;
  const r = db.run('INSERT OR IGNORE INTO courier_incidents (order_id, courier_id, kind, reason, created_at) VALUES (?, ?, ?, ?, ?)', orderId, courierId, kind, reason, now());
  if (r.changes) db.audit(courierId, 'livreur.incident', `order:${orderId}`, { kind, reason });
}
module.exports = { serviceRating, incident };
