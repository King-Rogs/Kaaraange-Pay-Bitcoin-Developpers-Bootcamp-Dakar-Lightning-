'use strict';
/** Intentions durables : aucun statut financier terminal avant confirmation LND. */
const db = require('./db');
const ln = require('./lightning');
const config = require('./config');
const { now, fail, lnError } = require('./util');
const { incident } = require('./courier-metrics');
const running = new Map();
const pendingStatus = { deliver: 'delivery_pending', cancel: 'cancel_pending', return: 'return_pending', return_complete: 'return_payment_pending', cancel_fee: 'return_payment_pending' };

async function confirmed(node, hash, target, secret) {
  const before = await node.lookup(hash);
  if (before.state === target) return;
  if (target === 'CANCELED' && before.state === 'SETTLED') throw new Error('Cette facture est déjà réglée : un arbitrage est nécessaire.');
  if (target === 'SETTLED' && before.state === 'CANCELED') throw new Error('Cette facture est annulée : un arbitrage est nécessaire.');
  try {
    if (target === 'CANCELED') await node.cancel(hash);
    else await node.settle(secret);
  } catch (error) {
    if ((await node.lookup(hash)).state !== target) throw error;
  }
  if ((await node.lookup(hash)).state !== target) throw new Error('Confirmation Lightning encore en attente.');
}

async function sync(order) {
  const states = await Promise.allSettled([ln.vendeur.lookup(order.item_hash), ln.livreur.lookup(order.fee_hash)]);
  const fields = {};
  if (states[0].status === 'fulfilled') fields.item_state = states[0].value.state;
  if (states[1].status === 'fulfilled') fields.fee_state = states[1].value.state;
  if (Object.keys(fields).length) db.update('orders', order.id, fields);
}

function schedule(order, kind, details = {}, actorId = null) {
  db.tx(() => {
    const existing = db.one('SELECT kind FROM order_actions WHERE order_id = ?', order.id);
    if (existing && existing.kind !== kind) fail(409, 'Une autre opération est déjà en cours pour cette commande.');
    if (existing) return;
    const fresh = db.one('SELECT status FROM orders WHERE id = ?', order.id);
    if (fresh.status !== order.status) fail(409, 'La commande a changé : actualisez la page.');
    db.run('INSERT INTO order_actions (order_id, kind, details, actor_id, created_at) VALUES (?, ?, ?, ?, ?)', order.id, kind, JSON.stringify(details), actorId, now());
    db.update('orders', order.id, { status: pendingStatus[kind] });
    if (details.no_show) incident(order.id, order.courier_id, 'no_show', details.reason);
    db.audit(actorId, 'commande.operation_demandee', `order:${order.id}`, { kind, reason: details.reason || null });
  });
  return process(order.id);
}

function process(orderId) {
  if (running.has(orderId)) return running.get(orderId);
  const promise = (async () => {
    const action = db.one('SELECT * FROM order_actions WHERE order_id = ?', orderId);
    if (!action) return db.one('SELECT * FROM orders WHERE id = ?', orderId);
    const order = db.one('SELECT * FROM orders WHERE id = ?', orderId);
    const d = JSON.parse(action.details);
    db.run('UPDATE order_actions SET attempted_at = ? WHERE order_id = ?', now(), orderId);
    try {
      const fields = {};
      let freeCourier = false;
      if (action.kind === 'deliver') {
        await confirmed(ln.vendeur, order.item_hash, 'SETTLED', d.secret);
        await confirmed(ln.livreur, order.fee_hash, 'SETTLED', order.fee_preimage);
        Object.assign(fields, { status: 'delivered', delivered_at: now(), item_state: 'SETTLED', fee_state: 'SETTLED' });
        freeCourier = true;
      } else if (action.kind === 'cancel') {
        await confirmed(ln.vendeur, order.item_hash, 'CANCELED');
        await confirmed(ln.livreur, order.fee_hash, 'CANCELED');
        Object.assign(fields, { status: 'canceled', canceled_at: now(), cancel_reason: d.reason, item_state: 'CANCELED', fee_state: 'CANCELED' });
        freeCourier = true;
      } else if (action.kind === 'return') {
        await confirmed(ln.vendeur, order.item_hash, 'CANCELED');
        Object.assign(fields, { status: 'returning', item_state: 'CANCELED', returning_at: order.returning_at || now(), return_deadline_at: order.return_deadline_at || now() + config.returnDeadlineMin * 60, return_cause: d.cause, refuse_reason: d.refuse_reason || null, refuse_comment: d.comment || null });
      } else if (action.kind === 'return_complete' || action.kind === 'cancel_fee') {
        await confirmed(ln.vendeur, order.item_hash, 'CANCELED');
        const state = action.kind === 'cancel_fee' ? 'CANCELED' : 'SETTLED';
        await confirmed(ln.livreur, order.fee_hash, state, order.fee_preimage);
        Object.assign(fields, { status: 'returned', returned_at: now(), item_state: 'CANCELED', fee_state: state, cancel_reason: action.kind === 'cancel_fee' ? d.reason || 'frais_annules_admin' : null });
        freeCourier = true;
      }
      db.tx(() => {
        db.update('orders', orderId, fields);
        if (freeCourier) {
          require('./dispatch').freeCourier(order.courier_id, orderId);
          db.run("UPDATE offers SET status = 'canceled', responded_at = ? WHERE order_id = ? AND status = 'pending'", now(), orderId);
        }
        db.run('DELETE FROM order_actions WHERE order_id = ?', orderId);
        db.audit(action.actor_id, d.audit || 'commande.operation_confirmee', `order:${orderId}`, { kind: action.kind, reason: d.reason || d.cause || null, item_sat: order.item_sat, fee_sat: order.fee_sat });
      });
    } catch (error) {
      await sync(order);
      db.run('UPDATE order_actions SET error = ? WHERE order_id = ?', lnError(error).message, orderId);
    }
    return db.one('SELECT * FROM orders WHERE id = ?', orderId);
  })().finally(() => running.delete(orderId));
  running.set(orderId, promise);
  return promise;
}

async function recover() {
  for (const a of db.all('SELECT order_id FROM order_actions WHERE attempted_at IS NULL OR attempted_at <= ?', now() - config.recoveryRetrySec)) await process(a.order_id);
}
module.exports = { schedule, process, recover, sync, pendingStatus };
