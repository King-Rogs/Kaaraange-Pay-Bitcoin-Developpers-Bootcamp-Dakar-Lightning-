'use strict';
const db = require('./db');

const DEMO_START_SATS = 2_000_000;

function accountBalance(userId) {
  const user = db.one('SELECT is_bot FROM users WHERE id = ?', userId);
  if (!user || user.is_bot) return 0;

  const buyer = db.one(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('searching_courier','assigned','picked_up','buyer_accepted','delivery_pending') THEN item_sat + fee_sat ELSE 0 END), 0) AS active_spend,
       COALESCE(SUM(CASE WHEN status = 'delivered' AND item_state = 'SETTLED' THEN item_sat ELSE 0 END), 0) AS delivered_items,
       COALESCE(SUM(CASE WHEN status = 'delivered' AND fee_state = 'SETTLED' THEN fee_sat ELSE 0 END), 0) AS delivered_fees,
       COALESCE(SUM(CASE WHEN status IN ('returning','return_pending','return_payment_pending','returned') AND fee_state = 'SETTLED' AND fee_refunded_at IS NULL THEN fee_sat ELSE 0 END), 0) AS unpaid_return_fees
     FROM orders WHERE buyer_id = ?`,
    userId,
  );
  const sellerEarned = db.one(
    "SELECT COALESCE(SUM(item_sat), 0) s FROM orders WHERE seller_id = ? AND status = 'delivered' AND item_state = 'SETTLED'",
    userId,
  ).s;
  const courierEarned = db.one(
    "SELECT COALESCE(SUM(fee_sat), 0) s FROM orders WHERE courier_id = ? AND fee_state = 'SETTLED'",
    userId,
  ).s;

  if (buyer.active_spend || buyer.delivered_items || buyer.delivered_fees || buyer.unpaid_return_fees) {
    return Math.max(0, DEMO_START_SATS - buyer.active_spend - buyer.delivered_items - buyer.delivered_fees - buyer.unpaid_return_fees);
  }
  return Math.max(0, DEMO_START_SATS + sellerEarned + courierEarned);
}

function lockedBalance(userId) {
  return db.one(
    `SELECT COALESCE(SUM(
       CASE WHEN item_state = 'ACCEPTED' AND status IN ('searching_courier','assigned','picked_up','buyer_accepted','return_pending') THEN item_sat ELSE 0 END +
       CASE WHEN fee_state = 'ACCEPTED' AND status IN ('searching_courier','assigned','picked_up','buyer_accepted','returning','return_pending','return_payment_pending') THEN fee_sat ELSE 0 END
     ), 0) s FROM orders WHERE buyer_id = ?`,
    userId,
  ).s;
}

module.exports = { DEMO_START_SATS, accountBalance, lockedBalance };
