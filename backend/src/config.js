'use strict';
/**
 * Configuration : lit backend/.env (format hérité de connect-lnd) puis les
 * variables d'environnement. Les variables déjà définies (par exemple par les
 * tests) ne sont jamais écrasées par le fichier .env.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const ROOT = path.join(__dirname, '..');

function str(name, def = '') {
  const v = env[name];
  return v === undefined || v === '' ? def : String(v).trim();
}
function num(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) {
    console.error(`Variable ${name} invalide : « ${v} » n'est pas un nombre.`);
    process.exit(1);
  }
  return n;
}
function bool(name, def) {
  const v = env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'oui', 'yes', 'on'].includes(String(v).toLowerCase());
}
function oneOf(name, values, def) {
  const v = str(name, def).toLowerCase();
  if (!values.includes(v)) {
    console.error(`Variable ${name} invalide : « ${v} ». Valeurs possibles : ${values.join(', ')}.`);
    process.exit(1);
  }
  return v;
}

/** Un nœud par rôle, au format connect-lnd (LND_*_<ROLE>). */
function lndNode(role, defaultId, defaultHost) {
  const R = role.toUpperCase();
  return {
    role,
    id: str(`LND_NODE_ID_${R}`, defaultId),
    socket: str(`LND_GRPC_HOST_${R}`, defaultHost),
    macaroon: str(`LND_MACAROON_BASE64_${R}`),
    cert: str(`LND_TLS_CERT_BASE64_${R}`),
  };
}

const config = {
  root: ROOT,
  port: num('PORT', 5000),
  host: str('HOST', '0.0.0.0'),
  devMode: bool('DEV_MODE', true),
  publicUrl: str('PUBLIC_URL', 'http://localhost:5173'),
  corsOrigin: str('CORS_ORIGIN'),
  apiKey: str('API_KEY'),
  cookieSecure: bool('COOKIE_SECURE', false),
  adminEmail: str('ADMIN_EMAIL').toLowerCase(),
  seedDemo: bool('SEED_DEMO', true),

  dbPath: path.resolve(ROOT, str('DB_PATH', 'data/kaaraange.db')),
  uploadDir: path.resolve(ROOT, str('UPLOAD_DIR', 'uploads')),
  frontendDist: path.resolve(ROOT, str('FRONTEND_DIST', '../frontend/dist')),

  lndMode: oneOf('LND_MODE', ['mock', 'lnd'], 'mock'),
  lndRpcTimeoutMs: num('LND_RPC_TIMEOUT_MS', 5000),
  lndPaymentTimeoutMs: num('LND_PAYMENT_TIMEOUT_MS', 30000),
  lndPathfindingMs: num('LND_PATHFINDING_MS', 10000),
  lnd: {
    acheteur: lndNode('acheteur', 'fatou', '127.0.0.1:10001'),
    vendeur: lndNode('vendeur', 'awa', '127.0.0.1:10002'),
    livreur: lndNode('livreur', 'moussa', '127.0.0.1:10003'),
  },

  btcMode: oneOf('BTC_MODE', ['mock', 'rpc'], 'mock'),
  btcMineTimeoutMs: num('BTC_MINE_TIMEOUT_MS', 120000),
  btcRpc: {
    url: str('BTC_RPC_URL', 'http://127.0.0.1:18443'),
    user: str('BTC_RPC_USER', 'polaruser'),
    pass: str('BTC_RPC_PASS', 'polarpass'),
  },

  priceMode: oneOf('PRICE_MODE', ['live', 'fixed'], 'live'),
  btcXofFallback: num('BTC_XOF_FALLBACK', 60_000_000),

  roadFactor: num('ROAD_FACTOR', 1.3),
  feeBaseXof: num('FEE_BASE_XOF', 500),
  feePerKmXof: num('FEE_PER_KM_XOF', 150),
  deadlineMin: num('DEADLINE_MIN', 120),
  returnDeadlineMin: num('RETURN_DEADLINE_MIN', 120),
  holdCltvDelta: num('HOLD_CLTV_DELTA', 288),
  recoveryRetrySec: num('RECOVERY_RETRY_SEC', 5),
  lowRatingThreshold: num('LOW_RATING_THRESHOLD', 3),
  invoiceExpiryMin: num('INVOICE_EXPIRY_MIN', 30),
  pickupRadiusKm: num('PICKUP_RADIUS_KM', 0.5),
  absentRadiusKm: num('ABSENT_RADIUS_KM', 0.5),
  offerSeconds: num('OFFER_SECONDS', 30),
  articleMaxSat: num('ARTICLE_MAX_SAT', 1_000_000),

  simulation: bool('SIMULATION', true),
  simBots: num('SIM_BOTS', 6),
  simStepKm: num('SIM_STEP_KM', 0.25),
  simAcceptRate: num('SIM_ACCEPT_RATE', 0.85),
  simAcceptDelaySec: num('SIM_ACCEPT_DELAY_SEC', 3),
  tickMs: num('TICK_MS', 2000),
};

for (const key of ['deadlineMin', 'returnDeadlineMin', 'invoiceExpiryMin']) {
  if (config[key] <= 0) throw new Error(`${key} doit être strictement positif.`);
}
// Cible Bitcoin de 10 min/bloc + 12 blocs de marge ; en regtest, le jury
// doit également contrôler le nombre de blocs minés pendant une commande.
const minimumCltv = Math.ceil((config.invoiceExpiryMin + config.deadlineMin + config.returnDeadlineMin) / 10) + 12;
if (!Number.isInteger(config.holdCltvDelta) || config.holdCltvDelta < minimumCltv) {
  throw new Error(`HOLD_CLTV_DELTA doit être un entier >= ${minimumCltv} pour couvrir les délais configurés.`);
}
if (config.recoveryRetrySec < 0 || config.lowRatingThreshold < 1 || config.lowRatingThreshold > 5) {
  throw new Error('RECOVERY_RETRY_SEC doit être positif ou nul et LOW_RATING_THRESHOLD compris entre 1 et 5.');
}
for (const key of ['lndRpcTimeoutMs', 'lndPaymentTimeoutMs', 'lndPathfindingMs']) {
  if (!Number.isInteger(config[key]) || config[key] < 100 || config[key] > 120000) throw new Error(`${key} doit être un entier entre 100 et 120000 ms.`);
}
if (!Number.isInteger(config.btcMineTimeoutMs) || config.btcMineTimeoutMs < 1000 || config.btcMineTimeoutMs > 600000) throw new Error('BTC_MINE_TIMEOUT_MS doit être entre 1000 et 600000 ms.');

module.exports = config;
