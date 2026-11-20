'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const { hashPassword } = require('./auth');
const { now, DAKAR } = require('./util');
const bitcoin = require('./bitcoin');
const { DEMO_START_SATS } = require('./account-balance');

/** Données idempotentes : ne remplace ni un prix modifié ni une photo importée. */
async function seedDemo() {
  const pw = await hashPassword('demo1234');
  const add = (email, name, extra = {}) => {
    const existing = db.one('SELECT id FROM users WHERE email = ?', email);
    if (existing) {
      db.update('users', existing.id, { name, ...extra, is_bot: 0 });
      return existing.id;
    }
    const { id } = db.run('INSERT INTO users (email,name,password_hash,is_demo,created_at) VALUES (?,?,?,1,?)', email, name, pw, now());
    db.update('users', id, extra);
    return id;
  };
  const medina = DAKAR[1];
  const awa = add('awa@demo.kaaraange.sn', 'Awa Couture', { shop_name: 'Awa Couture', shop_lat: medina.lat, shop_lng: medina.lng, shop_address: 'Médina, Dakar', phone: '+221 70 000 00 01' });
  const fatouId = add('fatou@demo.kaaraange.sn', 'Fatou Ndiaye', { phone: '+221 70 000 00 02' });
  const moussa = add('moussa@demo.kaaraange.sn', 'Moussa Sarr', { phone: '+221 70 000 00 03' });
  require('./dispatch').ensureCourier(moussa);
  db.update('couriers', moussa, {
    status: 'available',
    mode: 'sim',
    lat: medina.lat,
    lng: medina.lng,
    location_at: now(),
    updated_at: now(),
  }, 'user_id');
  if (config.btcMode === 'mock' && !db.kvGet('demo.accounts.2m.v1')) {
    for (const userId of [awa, fatouId, moussa]) {
      const name = `kp_u${userId}`;
      await bitcoin.chain.createWallet(name);
      await bitcoin.chain.setBalance(name, DEMO_START_SATS);
      const existing = db.one('SELECT id FROM btc_wallets WHERE user_id = ? AND wallet_name = ?', userId, name);
      if (!existing) db.run(
        'INSERT INTO btc_wallets (user_id,wallet_name,label,is_active,created_at) VALUES (?,?,?,?,?)',
        userId,
        name,
        'Principal',
        1,
        now(),
      );
      else db.update('btc_wallets', existing.id, { is_active: 1 });
    }
    db.kvSet('demo.accounts.2m.v1', { sats: DEMO_START_SATS, initialized_at: now() });
  }
  const articles = [
    ['Robe wax ndokette', 'Exemple d’article : robe en wax cousue main, taille au choix.', 25000, 'robe'],
    ['Ensemble bazin brodé', 'Exemple d’article : bazin riche brodé, livré plié sous housse.', 60000, 'bazin'],
    ['Sac en cuir tressé', 'Exemple d’article : sac artisanal en cuir tressé.', 35000, 'sac'],
  ];
  fs.mkdirSync(config.uploadDir, { recursive: true });
  for (const [title, description, sats, image] of articles) {
    let article = db.one('SELECT * FROM articles WHERE seller_id = ? AND title = ?', awa, title);
    if (!article) {
      const { id } = db.run('INSERT INTO articles (seller_id,title,description,price_sat,created_at) VALUES (?,?,?,?,?)', awa, title, description, sats, now());
      article = db.one('SELECT * FROM articles WHERE id = ?', id);
    }
    if (!article.image) {
      const name = `demo-${image}.svg`;
      fs.copyFileSync(path.join(__dirname, '..', 'assets', name), path.join(config.uploadDir, name));
      db.update('articles', article.id, { image: name });
    }
  }
}
module.exports = { seedDemo };
