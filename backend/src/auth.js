'use strict';
/**
 * Comptes, sessions, mot de passe oublié, profil, photo et notes.
 *  - mots de passe : crypto.scrypt avec sel aléatoire (aucun module natif) ;
 *  - sessions : jeton aléatoire dans un cookie HttpOnly, seul son SHA-256 est en base ;
 *  - jetons de réinitialisation : hachés, usage unique, 30 minutes.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const v = require('./util');
const { fail, now, sha256hex, randomHex } = v;

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'kp_session';
const DAY = 86400;
const RESET_TTL = 30 * 60;

/* ---------- Mots de passe ---------- */

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(pw, stored) {
  const [algo, saltHex, keyHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(String(pw || ''), Buffer.from(saltHex, 'hex'), 64);
  const ref = Buffer.from(keyHex, 'hex');
  return ref.length === key.length && crypto.timingSafeEqual(ref, key);
}

/* ---------- Notes ---------- */

function ratingsOf(userId) {
  const rows = db.all('SELECT role, AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE target_id = ? GROUP BY role', userId);
  const out = { vendeur: { avg: null, count: 0 }, livreur: { avg: null, count: 0 }, client: { avg: null, count: 0 } };
  for (const r of rows) out[r.role] = { avg: Math.round(r.avg * 10) / 10, count: r.count };
  return out;
}

const avatarUrl = (u) => (u && u.avatar ? `/uploads/${u.avatar}` : null);

/** Vue publique d'un utilisateur (jamais le hash du mot de passe). */
function publicUser(u, { self = false } = {}) {
  if (!u) return null;
  const out = {
    id: u.id,
    name: u.name,
    shop_name: u.shop_name || '',
    avatar_url: avatarUrl(u),
    is_bot: !!u.is_bot,
    is_demo: !!u.is_demo,
  };
  if (self) {
    Object.assign(out, {
      email: u.email,
      phone: u.phone || '',
      shop: u.shop_lat == null ? null : { lat: u.shop_lat, lng: u.shop_lng, address: u.shop_address || '' },
      is_admin: !!u.is_admin,
      created_at: u.created_at,
      ratings: ratingsOf(u.id),
    });
  }
  return out;
}

/* ---------- Sessions ---------- */

function createSession(res, userId, remember) {
  const token = randomHex(32);
  const ttl = remember ? 30 * DAY : DAY;
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', sha256hex(token), userId, now() + ttl, now());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: ttl * 1000 });
}

/** Charge l'utilisateur de la session (ou null) sur chaque requête /api. */
function loadUser(req, _res, next) {
  req.user = null;
  const token = v.parseCookies(req.headers.cookie)[COOKIE];
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    const hash = sha256hex(token);
    const row = db.one(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_suspended = 0',
      hash,
      now(),
    );
    if (row) {
      req.user = row;
      req.sessionHash = hash;
      if (!row.last_seen_at || now() - row.last_seen_at > 60) db.update('users', row.id, { last_seen_at: now() });
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) fail(401, 'Connectez-vous pour continuer.');
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) fail(401, 'Connectez-vous pour continuer.');
  if (!req.user.is_admin) fail(403, 'Accès réservé aux administrateurs.');
  next();
}

/**
 * Un compte administrateur n'a pas les droits d'un utilisateur ordinaire :
 * il ne peut ni acheter, ni vendre, ni livrer. À poser après requireAuth sur
 * les routes commerce/livraison (jamais sur /api/me, le profil reste géré
 * normalement).
 */
function blockAdmin(req, _res, next) {
  if (req.user?.is_admin) fail(403, 'Un compte administrateur ne peut pas acheter, vendre ou livrer.');
  next();
}

/** Limite simple des tentatives de connexion (10 échecs / 15 min par IP + e-mail). */
const attempts = new Map();
function tooManyAttempts(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) return false;
  return a.count >= 10;
}
function noteFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 15 * 60_000 });
  else a.count += 1;
}

function promoteAdminIfNeeded(user) {
  if (config.adminEmail && user.email === config.adminEmail && !user.is_admin) {
    db.update('users', user.id, { is_admin: 1 });
    db.audit(user.id, 'admin.promotion_auto', `user:${user.id}`, { via: 'ADMIN_EMAIL' });
    user.is_admin = 1;
  }
}

/* ---------- Fichiers image ---------- */

/** Vrai type d'une image d'après ses premiers octets (signature). */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function removeAvatarFile(name) {
  if (!name || !/^[0-9a-f]{32}\.(png|jpg|webp)$/.test(name)) return;
  fs.rm(path.join(config.uploadDir, name), { force: true }, () => {});
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/* ---------- Routes ---------- */

const router = express.Router();

router.post('/auth/register', async (req, res) => {
  const b = req.body || {};
  const name = v.text(b.name, { field: 'name', label: 'Le nom', min: 2, max: 80, required: true });
  const email = v.email(b.email);
  const pw = v.password(b.password);
  if (db.one('SELECT id FROM users WHERE email = ?', email)) fail(409, 'Un compte existe déjà avec cette adresse e-mail.', 'email');
  const hash = await hashPassword(pw);
  const { id } = db.run('INSERT INTO users (email, name, password_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', email, name, hash, now(), now());
  const user = db.one('SELECT * FROM users WHERE id = ?', id);
  db.audit(id, 'compte.inscription', `user:${id}`, { email }, req.ip);
  promoteAdminIfNeeded(user);
  createSession(res, id, !!b.remember);
  res.status(201).json({ user: publicUser(user, { self: true }) });
});

router.post('/auth/login', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  if (tooManyAttempts(key)) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  const user = email ? db.one('SELECT * FROM users WHERE email = ?', email) : null;
  const ok = user && !user.is_bot && (await checkPassword(b.password, user.password_hash));
  if (!ok) {
    noteFailure(key);
    db.audit(user ? user.id : null, 'compte.connexion_echouee', user ? `user:${user.id}` : null, { email }, req.ip);
    fail(401, 'E-mail ou mot de passe incorrect.');
  }
  if (user.is_suspended) {
    db.audit(user.id, 'compte.connexion_refusee_suspendu', `user:${user.id}`, null, req.ip);
    fail(403, 'Ce compte est suspendu. Contactez un administrateur.');
  }
  attempts.delete(key);
  promoteAdminIfNeeded(user);
  createSession(res, user.id, !!b.remember);
  db.update('users', user.id, { last_seen_at: now() });
  db.audit(user.id, 'compte.connexion', `user:${user.id}`, { remember: !!b.remember }, req.ip);
  res.json({ user: publicUser(user, { self: true }) });
});

router.post('/auth/logout', (req, res) => {
  if (req.sessionHash) db.run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user, { self: true }) : null });
});

router.post('/auth/forgot', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const user = email ? db.one('SELECT * FROM users WHERE email = ? AND is_bot = 0', email) : null;
  const out = { ok: true, message: 'Si un compte existe pour cette adresse, un lien de réinitialisation valable 30 minutes vient d’être envoyé.' };
  if (user) {
    const token = randomHex(32);
    db.run('INSERT INTO reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', sha256hex(token), user.id, now() + RESET_TTL, now());
    db.audit(user.id, 'compte.mot_de_passe_oublie', `user:${user.id}`, null, req.ip);
    const link = `${config.publicUrl.replace(/\/$/, '')}/reinitialiser?token=${token}`;
    if (config.devMode) {
      // Pas de serveur e-mail en développement : le lien est affiché à l'écran et dans la console.
      console.log(`[DEV_MODE] Lien de réinitialisation pour ${email} : ${link}`);
      out.dev_link = link;
    }
  }
  res.json(out);
});

router.post('/auth/reset', async (req, res) => {
  const b = req.body || {};
  const token = String(b.token || '');
  const row = /^[0-9a-f]{64}$/.test(token) ? db.one('SELECT * FROM reset_tokens WHERE token_hash = ?', sha256hex(token)) : null;
  if (!row || row.used_at || row.expires_at < now()) fail(400, 'Ce lien est invalide, expiré ou déjà utilisé. Faites une nouvelle demande.', 'token');
  const pw = v.password(b.password);
  const hash = await hashPassword(pw);
  db.tx(() => {
    db.update('reset_tokens', row.token_hash, { used_at: now() }, 'token_hash');
    db.update('users', row.user_id, { password_hash: hash });
    db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
  });
  db.audit(row.user_id, 'compte.mot_de_passe_reinitialise', `user:${row.user_id}`, null, req.ip);
  res.json({ ok: true, message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
});

router.patch('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const fields = {};
  if (b.name !== undefined) fields.name = v.text(b.name, { field: 'name', label: 'Le nom', min: 2, max: 80, required: true });
  if (b.phone !== undefined) {
    const phone = v.text(b.phone, { field: 'phone', label: 'Le téléphone', max: 30 });
    if (phone && !/^\+?[0-9 .-]{6,20}$/.test(phone)) fail(400, 'Numéro de téléphone invalide.', 'phone');
    fields.phone = phone;
  }
  if (b.shop_name !== undefined) fields.shop_name = v.text(b.shop_name, { field: 'shop_name', label: 'Le nom de la boutique', max: 80 });
  if (b.shop !== undefined) {
    if (b.shop === null) Object.assign(fields, { shop_lat: null, shop_lng: null, shop_address: '' });
    else {
      const { lat, lng } = v.coords(b.shop.lat, b.shop.lng, 'shop');
      fields.shop_lat = lat;
      fields.shop_lng = lng;
      fields.shop_address = v.text(b.shop.address, { field: 'shop_address', label: "L'adresse", max: 200 });
    }
  }
  db.update('users', req.user.id, fields);
  if (Object.keys(fields).length) db.audit(req.user.id, 'compte.profil_modifie', `user:${req.user.id}`, { champs: Object.keys(fields) }, req.ip);
  res.json({ user: publicUser(db.one('SELECT * FROM users WHERE id = ?', req.user.id), { self: true }) });
});

router.put('/me/password', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!(await checkPassword(b.current, req.user.password_hash))) fail(400, 'Mot de passe actuel incorrect.', 'current');
  const pw = v.password(b.password);
  db.update('users', req.user.id, { password_hash: await hashPassword(pw) });
  db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', req.user.id, req.sessionHash);
  db.audit(req.user.id, 'compte.mot_de_passe_modifie', `user:${req.user.id}`, null, req.ip);
  res.json({ ok: true });
});

router.post('/me/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) fail(400, 'Aucune image reçue.', 'avatar');
  const ext = sniffImage(req.file.buffer);
  if (!ext) fail(400, 'Format non accepté : seules les vraies images PNG, JPG ou WebP sont acceptées.', 'avatar');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const name = `${randomHex(16)}.${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, name), req.file.buffer);
  removeAvatarFile(req.user.avatar);
  db.update('users', req.user.id, { avatar: name });
  res.json({ user: publicUser(db.one('SELECT * FROM users WHERE id = ?', req.user.id), { self: true }) });
});

router.delete('/me/avatar', requireAuth, (req, res) => {
  removeAvatarFile(req.user.avatar);
  db.update('users', req.user.id, { avatar: null });
  res.json({ user: publicUser(db.one('SELECT * FROM users WHERE id = ?', req.user.id), { self: true }) });
});

router.get('/users/:id/reviews', requireAuth, (req, res) => {
  const id = v.idParam(req.params.id);
  const u = db.one('SELECT * FROM users WHERE id = ?', id);
  if (!u) fail(404, 'Utilisateur introuvable.');
  const reviews = db.all(
    `SELECT r.id, r.order_id, r.role, r.rating, r.comment, r.created_at, a.id AS author_id, a.name AS author_name, a.avatar AS author_avatar
     FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.target_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    id,
  );
  res.json({
    user: publicUser(u),
    ratings: ratingsOf(id),
    reviews: reviews.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      role: r.role,
      rating: r.rating,
      comment: r.comment,
      created_at: r.created_at,
      author: { id: r.author_id, name: r.author_name, avatar_url: r.author_avatar ? `/uploads/${r.author_avatar}` : null },
    })),
  });
});

module.exports = { router, loadUser, requireAuth, requireAdmin, blockAdmin, publicUser, ratingsOf, hashPassword, checkPassword, avatarUrl, sniffImage, COOKIE };
