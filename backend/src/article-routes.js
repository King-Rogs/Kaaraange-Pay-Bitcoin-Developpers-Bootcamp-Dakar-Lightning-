'use strict';
const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const { requireAuth, blockAdmin, sniffImage } = require('./auth');
const { fail, idParam, randomHex } = require('./util');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const articleView = (article, viewer) => require('./orders').articleView(article, viewer);
function activeArticle(id) {
  const a = db.one('SELECT a.* FROM articles a JOIN users u ON u.id = a.seller_id WHERE a.id = ? AND a.is_active = 1 AND u.is_suspended = 0', idParam(id));
  if (!a) fail(404, 'Cet article n’est plus disponible.');
  return a;
}

router.get('/public/articles', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const all = db.all('SELECT a.* FROM articles a JOIN users u ON u.id = a.seller_id WHERE a.is_active = 1 AND u.is_suspended = 0 ORDER BY a.created_at DESC LIMIT 200');
  res.json({ articles: all.filter(a => !q || `${a.title} ${a.description}`.toLowerCase().includes(q)).map(a => articleView(a, req.user)) });
});
router.get('/public/articles/:id', (req, res) => {
  const a = activeArticle(req.params.id);
  const reviews = db.all('SELECT r.id, r.rating, r.comment, r.created_at, u.name AS author_name FROM product_reviews r JOIN users u ON u.id = r.buyer_id WHERE r.article_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 50', a.id);
  res.json({ article: articleView(a, req.user), reviews });
});
router.post('/articles/:id/image', requireAuth, blockAdmin, upload.single('image'), (req, res) => {
  const a = db.one('SELECT * FROM articles WHERE id = ? AND seller_id = ?', idParam(req.params.id), req.user.id);
  if (!a) fail(404, 'Article introuvable.');
  const ext = req.file && sniffImage(req.file.buffer);
  if (!ext) fail(400, 'Choisissez une véritable image PNG, JPG ou WebP, de 2 Mo maximum.', 'image');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const name = `article-${a.id}-${randomHex(12)}.${ext}`;
  fs.writeFileSync(path.join(config.uploadDir, name), req.file.buffer);
  db.update('articles', a.id, { image: name });
  if (a.image && /^article-\d+-[a-f0-9]+\.(png|jpg|webp)$/.test(a.image)) {
    try { fs.unlinkSync(path.join(config.uploadDir, a.image)); } catch {}
  }
  db.audit(req.user.id, 'article.photo', `article:${a.id}`, null, req.ip);
  res.json({ article: articleView(db.one('SELECT * FROM articles WHERE id = ?', a.id), req.user) });
});
module.exports = { router };
