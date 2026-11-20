'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../src/config');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const { seedDemo } = require('../src/demo');
const { now } = require('../src/util');

async function main() {
  if (!config.devMode) throw new Error('La préparation de démonstration nécessite DEV_MODE=true.');
  db.open(config.dbPath);
  try {
    await seedDemo();
    const email = config.adminEmail || 'admin@kaaraange.sn';
    const file = path.join(config.root, 'data', 'demo-access.json');
    let access = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const existing = db.one('SELECT * FROM users WHERE email = ?', email);
    if (!existing) {
      const password = `Kp-${crypto.randomBytes(15).toString('base64url')}!9`;
      const hash = await hashPassword(password);
      const { id } = db.run('INSERT INTO users (email,name,password_hash,is_admin,is_demo,created_at) VALUES (?,?,?,1,1,?)', email, 'Administration Kaaraange Pay (démo)', hash, now());
      db.audit(id, 'admin.creation_demo', `user:${id}`);
      access = { email, password, created_at: now() };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(access, null, 2), { mode: 0o600 });
    } else {
      if (!existing.is_admin) { db.update('users', existing.id, { is_admin: 1 }); db.audit(null, 'admin.promotion_demo', `user:${existing.id}`); }
      if (access.email !== email) access = { email, note: 'Compte existant : son mot de passe est conservé. Utiliser la réinitialisation locale si nécessaire.' };
    }
    console.log(JSON.stringify({ ok: true, database: config.dbPath, admin_email: email, access_file: access.password ? file : null, note: access.note || 'Identifiants conservés dans le fichier local ignoré par Git.', orders_unchanged: true }));
  } finally { db.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
