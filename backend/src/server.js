'use strict';
/**
 * Kaaraange Pay — serveur Express.
 * Étend la passerelle connect-lnd (Express + ln-service, nœuds configurés par .env)
 * pour en faire le backend complet : comptes, commandes à 2 hold invoices,
 * livreurs, portefeuille, explorateur, console Lightning et administration.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const bitcoin = require('./bitcoin');
const ln = require('./lightning');
const price = require('./price');
const auth = require('./auth');
const orders = require('./orders');
const dispatch = require('./dispatch');
const chain = require('./chain');
const admin = require('./admin');
const { HttpError, lnError, now } = require('./util');

const { seedDemo } = require('./demo');

/* ---------- Application ---------- */

async function createServer({ loops = true } = {}) {
  db.open(config.dbPath);
  bitcoin.init();
  ln.init(() => bitcoin.chain.heightSync());

  if (config.adminEmail) {
    const r = db.run('UPDATE users SET is_admin = 1 WHERE email = ? AND is_admin = 0 AND is_bot = 0', config.adminEmail);
    if (r.changes) db.audit(null, 'admin.promotion_auto', `email:${config.adminEmail}`, { via: 'ADMIN_EMAIL' });
  }
  if (config.seedDemo) await seedDemo();
  if (config.simulation) dispatch.seedBots(config.simBots);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  if (config.corsOrigin) {
    const origins = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
    app.use('/api', cors({ origin: origins, credentials: true }));
  }
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    const [nodes, btc] = await Promise.all([Promise.all(ln.all.map(async (n) => ({ id: n.id, role: n.role, ...(await n.health()) }))), bitcoin.chain.health()]);
    const ok = nodes.every((n) => n.reachable) && btc.reachable;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degrade',
      modes: { LND_MODE: config.lndMode, BTC_MODE: config.btcMode, SIMULATION: config.simulation },
      nodes,
      bitcoind: btc,
      time: now(),
    });
  });

  app.get('/api/price', async (_req, res) => {
    const p = await price.get();
    res.json({ btc_xof: Math.round(p.btc_xof), source: p.source, updated_at: p.updated_at });
  });

  app.use('/api/nodes', chain.gateway);
  app.use('/api', auth.loadUser);
  app.use('/api', auth.router, require('./article-routes').router, orders.router, dispatch.router, chain.router, admin.router);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route introuvable.' }));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false, index: false }));

  if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json(err.field ? { error: err.message, field: err.field } : { error: err.message });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Image trop lourde : 2 Mo maximum.', field: 'avatar' });
      return res.status(400).json({ error: 'Envoi de fichier invalide.', field: 'avatar' });
    }
    if (Array.isArray(err)) {
      const e = lnError(err);
      return res.status(e.status).json({ error: e.message });
    }
    if (err && (err.status === 404 || err.statusCode === 404)) return res.status(404).json({ error: 'Fichier introuvable.' });
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  /* Boucles : synchronisation LND, échéances, attribution, simulation (toutes les 2 s). */
  let timer = null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await orders.tick();
      dispatch.tick();
    } catch (e) {
      console.error('Erreur dans la boucle de fond :', e);
    } finally {
      running = false;
    }
  }
  if (loops) timer = setInterval(tick, config.tickMs);

  let server = null;
  return {
    app,
    tick,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve) => {
        server = app.listen(port, host, () => resolve(server));
      });
    },
    async stop() {
      if (timer) clearInterval(timer);
      if (server) {
        const closed = new Promise((r) => server.close(r));
        server.closeAllConnections();
        await closed;
      }
      db.close();
    },
  };
}

async function main() {
  const srv = await createServer();
  await srv.listen();
  const line = '─'.repeat(60);
  console.log(line);
  console.log(`Kaaraange Pay — API sur http://localhost:${config.port}`);
  console.log(`Lightning : ${config.lndMode === 'mock' ? 'réseau simulé (alice, bob, carol)' : ln.all.map((n) => `${n.id}@${n.socket}`).join(', ')}`);
  console.log(`Bitcoin   : ${config.btcMode === 'mock' ? 'chaîne regtest simulée' : config.btcRpc.url}`);
  console.log(`Simulation des livreurs : ${config.simulation ? `oui (${config.simBots} livreurs fictifs)` : 'non'}`);
  if (config.devMode) console.log('DEV_MODE actif : les liens de réinitialisation sont affichés (ne pas utiliser en production).');
  if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) console.log(`Interface compilée servie sur http://localhost:${config.port}`);
  else console.log('Interface : lancez « npm run dev » dans frontend/ puis ouvrez http://localhost:5173');
  console.log(line);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      srv.stop().finally(() => process.exit(0));
    });
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Démarrage impossible :', e);
    process.exit(1);
  });
}

module.exports = { createServer };
