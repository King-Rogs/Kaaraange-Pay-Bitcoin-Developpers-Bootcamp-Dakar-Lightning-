'use strict';
/** Validation on-chain réelle, après résolution de tous les HTLC. */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaraange-bitcoin-polar-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), SEED_DEMO: 'false', SIMULATION: 'false', ADMIN_EMAIL: '', COOKIE_SECURE: 'false' });
const config = require('../src/config');
const db = require('../src/db');
const { createServer } = require('../src/server');
const { hashPassword } = require('../src/auth');
const ln = require('../src/lightning');
const bitcoin = require('../src/bitcoin');
const { now } = require('../src/util');
let srv, base;
const wallets = [], checks = [];
const report = path.join(config.root, 'data/backend-validation/bitcoin-resultats.json');
async function request(cookie, method, url, body, expected = 200) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie: cookie || '' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(config.btcMineTimeoutMs + 15000) });
  const data = await r.json(); assert.equal(r.status, expected, `${url}: ${data.error || r.status}`); return { ...data, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}
async function check(name, fn) { await fn(); checks.push(name); console.log(`OK Bitcoin Polar : ${name}`); }
async function main() {
  assert.equal(config.lndMode, 'lnd'); assert.equal(config.btcMode, 'rpc');
  srv = await createServer({ loops: false }); const server = await srv.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await bitcoin.chain.chainInfo()).chain, 'regtest');
  for (const node of ln.all) assert.ok((await node.channels()).every(c => !c.unsettled_balance), 'Aucun minage avant résolution des HTLC');
  // IDs réservés à cet essai : ne jamais réutiliser les portefeuilles d’un
  // utilisateur de la base principale en démarrant une base temporaire vide.
  const firstId = 1000000000 + Math.floor(Date.now() % 100000000), hash = await hashPassword('Validation1234!');
  const cookies = [];
  for (let i = 0; i < 2; i++) {
    const id = firstId + i, email = `wallet-${id}@polar-validation.test`;
    assert.equal(await bitcoin.chain.walletExists(`kp_u${id}`), false, 'Le portefeuille de test doit être inédit');
    db.run('INSERT INTO users (id,email,name,password_hash,is_demo,created_at) VALUES (?,?,?,?,1,?)', id, email, `Portefeuille validation ${i}`, hash, now());
    cookies.push((await request('', 'POST', '/api/auth/login', { email, password: 'Validation1234!' })).cookie);
    wallets.push(`kp_u${id}`);
  }
  let recipient, txid;
  await check('création de deux portefeuilles Core dédiés et adresses bech32', async () => {
    for (const cookie of cookies) { await request(cookie, 'POST', '/api/wallet/create', {}, 201); const w = await request(cookie, 'GET', '/api/wallet'); assert.equal(w.mode, 'rpc'); assert.equal(w.exists, true); }
    recipient = (await request(cookies[1], 'POST', '/api/wallet/address', {})).address; assert.match(recipient, /^bcrt1/);
  });
  await check('minage de 101 blocs : maturité coinbase et UTXO dépensables', async () => {
    const m = await request(cookies[0], 'POST', '/api/wallet/mine', { blocks: 101 }); assert.equal(m.mined, 101);
    const w = await request(cookies[0], 'GET', '/api/wallet'); assert.ok(w.balances.trusted_sat > 0); assert.ok(w.balances.immature_sat > 0); assert.ok(w.utxos.some(u => u.spendable));
  });
  await check('envoi exact, mempool et confirmation dans l’explorateur', async () => {
    const sent = await request(cookies[0], 'POST', '/api/wallet/send', { address: recipient, amount_sat: 50000 }); txid = sent.txid; assert.match(txid, /^[a-f0-9]{64}$/);
    const info = await request(cookies[0], 'GET', '/api/btc/chain'); assert.ok(info.mempool_size > 0);
    await request(cookies[0], 'POST', '/api/wallet/mine', { blocks: 1 });
    const block = (await request(cookies[0], 'GET', `/api/btc/block/${info.blocks + 1}`)).block; assert.ok(block.txs.some(t => t.txid === txid)); assert.ok(block.txs.some(t => t.coinbase));
    const receiver = await request(cookies[1], 'GET', '/api/wallet'); assert.equal(receiver.balances.trusted_sat, 50000); assert.ok(receiver.transactions.some(t => t.txid === txid && t.confirmations > 0));
  });
  await check('les trois LND rejoignent la nouvelle hauteur sans perdre les canaux', async () => {
    const tip = (await bitcoin.chain.chainInfo()).blocks, end = Date.now() + 30000;
    let ok = false;
    while (Date.now() < end) { const nodes = await Promise.all(ln.all.map(n => n.nodeInfo())); if (nodes.every(n => n.synced && n.block_height === tip)) { ok = true; break; } await new Promise(r => setTimeout(r, 250)); }
    assert.ok(ok); for (const n of ln.all) assert.ok((await n.channels()).every(c => c.is_active && c.unsettled_balance === 0));
  });
  fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify({ completed: true, passed: checks.length, checks, wallets, txid, mode: 'Bitcoin Core et LND regtest réels', date: new Date().toISOString() }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify({ completed: false, checks, wallets, error: error.message }, null, 2)); }).finally(async () => { if (srv) await srv.stop(); process.exit(process.exitCode || 0); });
