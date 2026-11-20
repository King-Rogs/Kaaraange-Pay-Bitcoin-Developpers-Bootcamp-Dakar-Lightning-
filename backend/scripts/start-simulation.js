'use strict';
Object.assign(process.env, { DB_PATH: 'data/kaaraange-scenarios.db', LND_MODE: 'mock', BTC_MODE: 'mock', SIMULATION: 'true', SEED_DEMO: 'true', PORT: '5001', PUBLIC_URL: 'http://localhost:5001', PRICE_MODE: 'fixed', COOKIE_SECURE: 'false', DEV_MODE: 'true' });
const { createServer } = require('../src/server');
(async () => { const srv = await createServer(); await srv.listen(); console.log('Kaaraange Pay : SIMULATION indépendante sur http://localhost:5001 — aucun accès Polar.'); const stop = () => srv.stop().then(() => process.exit()); process.once('SIGINT', stop); process.once('SIGTERM', stop); })().catch(e => { console.error(e.message); process.exitCode = 1; });
