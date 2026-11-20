'use strict';
/**
 * Base SQLite via node:sqlite (intégré à Node 22, aucune compilation native).
 * SQL volontairement simple pour rester migrable vers MySQL.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { now } = require('./util');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  shop_name TEXT NOT NULL DEFAULT '',
  shop_lat REAL,
  shop_lng REAL,
  shop_address TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_suspended INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_sat INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  removed_reason TEXT,
  removed_by_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  courier_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  item_sat INTEGER NOT NULL,
  fee_sat INTEGER NOT NULL,
  fee_xof INTEGER NOT NULL,
  distance_km REAL NOT NULL,
  btc_xof REAL NOT NULL,
  shop_lat REAL NOT NULL,
  shop_lng REAL NOT NULL,
  shop_address TEXT NOT NULL DEFAULT '',
  delivery_lat REAL NOT NULL,
  delivery_lng REAL NOT NULL,
  delivery_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  item_hash TEXT NOT NULL UNIQUE,
  item_request TEXT NOT NULL,
  item_state TEXT NOT NULL DEFAULT 'OPEN',
  fee_hash TEXT NOT NULL UNIQUE,
  fee_preimage TEXT NOT NULL,
  fee_request TEXT NOT NULL,
  fee_state TEXT NOT NULL DEFAULT 'OPEN',
  pay_error TEXT,
  return_cause TEXT,
  refuse_reason TEXT,
  refuse_comment TEXT,
  cancel_reason TEXT,
  dispatch_round INTEGER NOT NULL DEFAULT 1,
  invoice_expires_at INTEGER NOT NULL,
  deadline_at INTEGER,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  assigned_at INTEGER,
  picked_up_at INTEGER,
  delivered_at INTEGER,
  returning_at INTEGER,
  returned_at INTEGER,
  canceled_at INTEGER,
  fee_refund_hash TEXT,
  fee_refund_request TEXT,
  fee_refund_error TEXT,
  fee_refund_attempt_at INTEGER,
  fee_refunded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id);

CREATE TABLE IF NOT EXISTS couriers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'offline',
  mode TEXT NOT NULL DEFAULT 'sim',
  lat REAL,
  lng REAL,
  location_at INTEGER,
  current_order_id INTEGER,
  offers_received INTEGER NOT NULL DEFAULT 0,
  offers_accepted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  courier_id INTEGER NOT NULL REFERENCES users(id),
  round INTEGER NOT NULL,
  cost REAL NOT NULL,
  distance_km REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_offers_order ON offers(order_id);
CREATE INDEX IF NOT EXISTS idx_offers_courier ON offers(courier_id, status);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  target_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (order_id, author_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews(target_id, role);

CREATE TABLE IF NOT EXISTS product_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  article_id INTEGER NOT NULL REFERENCES articles(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(order_id, buyer_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_article ON product_reviews(article_id);

CREATE TABLE IF NOT EXISTS courier_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  courier_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(order_id, courier_id, kind)
);

CREATE TABLE IF NOT EXISTS order_actions (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id),
  kind TEXT NOT NULL,
  details TEXT NOT NULL,
  actor_id INTEGER,
  created_at INTEGER NOT NULL,
  attempted_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS btc_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  wallet_name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_btc_wallets_user ON btc_wallets(user_id);
`;

let db = null;

/** node:sqlite refuse undefined et les booléens : on normalise les paramètres. */
const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  for (const [table, fields] of Object.entries({
    orders: [['fee_refund_request', 'TEXT'], ['fee_refund_error', 'TEXT'], ['fee_refund_attempt_at', 'INTEGER'], ['return_deadline_at', 'INTEGER'], ['buyer_accepted_at', 'INTEGER']],
    articles: [['image', 'TEXT']],
  })) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, type] of fields) if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  return db;
}

function close() {
  if (db) db.close();
  db = null;
}

const one = (sql, ...p) => db.prepare(sql).get(...norm(p)) || null;
const all = (sql, ...p) => db.prepare(sql).all(...norm(p));
const run = (sql, ...p) => {
  const r = db.prepare(sql).run(...norm(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};

/** Transaction simple (BEGIN / COMMIT, ROLLBACK en cas d'erreur). */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Mise à jour partielle d'une ligne : update('orders', 3, { status: 'x' }). */
function update(table, id, fields, key = 'id') {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${key} = ?`, ...keys.map((k) => fields[k]), id);
}

/* Petit magasin clé/valeur : sert à persister les réseaux simulés. */
const kvGet = (k) => {
  const row = one('SELECT v FROM kv WHERE k = ?', k);
  return row ? JSON.parse(row.v) : null;
};
const kvSet = (k, v) => run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));

/** Journal d'audit : qui, quoi, sur quoi, avec quels détails. */
function audit(userId, action, target = null, details = null, ip = null) {
  run(
    'INSERT INTO audit (at, user_id, action, target, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    now(),
    userId ?? null,
    action,
    target,
    details == null ? null : JSON.stringify(details),
    ip,
  );
}

module.exports = { open, close, one, all, run, tx, update, kvGet, kvSet, audit, get raw() { return db; } };
