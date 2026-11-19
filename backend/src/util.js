'use strict';
/** Outils partagés : erreurs HTTP, géographie, validation, cryptographie. */
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}
const fail = (status, message, field) => {
  throw new HttpError(status, message, field);
};

const now = () => Math.floor(Date.now() / 1000);
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);

/* ---------- Géographie ---------- */

const R_EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau en km (formule de haversine). */
function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Avance d'au plus `stepKm` en ligne droite vers la cible. */
function moveToward(from, to, stepKm) {
  const d = haversine(from.lat, from.lng, to.lat, to.lng);
  if (d <= stepKm || d === 0) return { lat: to.lat, lng: to.lng, arrived: true, remainingKm: 0 };
  const t = stepKm / d;
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
    arrived: false,
    remainingKm: d - stepKm,
  };
}

/** Points de repère à Dakar (§6.5). */
const DAKAR = [
  { name: 'Plateau', lat: 14.6928, lng: -17.4467 },
  { name: 'Médina', lat: 14.6822, lng: -17.4535 },
  { name: 'Sacré-Cœur', lat: 14.7167, lng: -17.4677 },
  { name: 'Liberté 6', lat: 14.7275, lng: -17.4636 },
  { name: 'Ouakam', lat: 14.724, lng: -17.492 },
  { name: 'Parcelles', lat: 14.764, lng: -17.444 },
];

/* ---------- Validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(v, { field, label, min = 0, max = 200, required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) fail(400, `${label} est obligatoire.`, field);
  if (s && s.length < min) fail(400, `${label} : au moins ${min} caractères.`, field);
  if (s.length > max) fail(400, `${label} : ${max} caractères au maximum.`, field);
  return s;
}

function email(v) {
  const s = text(v, { field: 'email', label: "L'adresse e-mail", max: 160, required: true }).toLowerCase();
  if (!EMAIL_RE.test(s)) fail(400, 'Adresse e-mail invalide.', 'email');
  return s;
}

function password(v, field = 'password') {
  const s = typeof v === 'string' ? v : '';
  if (s.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.', field);
  if (s.length > 200) fail(400, 'Mot de passe trop long.', field);
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) fail(400, 'Le mot de passe doit contenir des lettres et des chiffres.', field);
  return s;
}

function coords(lat, lng, field = 'position') {
  const la = Number(lat);
  const lo = Number(lng);
  if (lat == null || lng == null || !Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
    fail(400, 'Position invalide.', field);
  }
  return { lat: la, lng: lo };
}

function intIn(v, { field, label, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(400, `${label} doit être un nombre entier.`, field);
  if (n < min || n > max) fail(400, `${label} doit être compris entre ${min} et ${max}.`, field);
  return n;
}

function idParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) fail(404, 'Ressource introuvable.');
  return n;
}

/* ---------- Erreurs Lightning ---------- */

/** Traduction des erreurs ln-service ([code, message, détails]) en français. */
const LN_MESSAGES = [
  [/secretdoesnotmatch/i, 'Ce secret ne correspond à aucune facture en attente.'],
  [/beforehtlcreceived/i, "Paiement pas encore reçu : impossible de régler la facture."],
  [/route|path|liquidity|insufficientbalance|nopath/i, 'Paiement impossible : aucun chemin avec assez de liquidité.'],
  [/alreadypaid|alreadysettled|invoiceisalreadypaid/i, 'Cette facture est déjà payée.'],
  [/expired/i, 'Cette facture a expiré.'],
  [/canceled|cancelled/i, 'Cette facture a été annulée.'],
  [/alreadyexists|duplicate/i, 'Une facture existe déjà pour ce hash.'],
  [/selfpayment|paytoself/i, 'Un nœud ne peut pas se payer lui-même.'],
  [/unknownpayment|unknowninvoice|invoicenotfound|notfound/i, 'Facture inconnue pour ce nœud.'],
  [/rejected|incorrectpaymentdetails/i, 'Paiement refusé par le destinataire.'],
  [/decode|invalidpaymentrequest|expectedpaymentrequest/i, 'Facture BOLT11 invalide.'],
  [/connect|unavailable|daemon|socket|timeout|deadline/i, 'Nœud LND injoignable. Vérifiez Polar et le fichier .env.'],
  [/permission|macaroon/i, 'Accès refusé par LND : vérifiez le macaroon.'],
];

function lnError(err) {
  if (err instanceof HttpError) return err;
  let name = '';
  let status = 502;
  if (Array.isArray(err)) {
    name = String(err[1] || '');
    const details = err[2] && (err[2].err || err[2]);
    const detailMsg = details && (details.details || details.message);
    if (detailMsg) name += ` ${detailMsg}`;
    if (typeof err[0] === 'number' && err[0] >= 400 && err[0] < 500) status = 400;
  } else if (err && err.message) {
    name = err.message;
  }
  const hit = LN_MESSAGES.find(([re]) => re.test(name.replace(/\s+/g, '')) || re.test(name));
  const e = new HttpError(status, hit ? hit[1] : `Erreur Lightning : ${name || 'inconnue'}.`);
  e.lnRaw = name;
  return e;
}

/* ---------- Cookies ---------- */

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

module.exports = {
  HttpError,
  fail,
  now,
  sha256hex,
  randomHex,
  isHex64,
  haversine,
  moveToward,
  DAKAR,
  text,
  email,
  password,
  coords,
  intIn,
  idParam,
  lnError,
  parseCookies,
  round,
};
