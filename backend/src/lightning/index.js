'use strict';
/**
 * Les trois nœuds de l'application, un par rôle :
 *   acheteur → alice (paie)  ·  vendeur → bob (facture A)  ·  livreur → carol (facture B)
 * Même interface en mode simulé (mock.js) et réel (real.js).
 */
const config = require('../config');
const db = require('../db');
const { lnError } = require('../util');

const ROLES = ['acheteur', 'vendeur', 'livreur'];
let nodes = null;
let network = null;

function init(heightFn) {
  if (config.lndMode === 'mock') {
    const { MockNetwork, mockNode, STORE_KEY } = require('./mock');
    network = new MockNetwork({ load: () => db.kvGet(STORE_KEY), save: (s) => db.kvSet(STORE_KEY, s) }, heightFn);
    const names = { acheteur: 'alice', vendeur: 'bob', livreur: 'carol' };
    nodes = Object.fromEntries(ROLES.map((r) => [r, mockNode(network, names[r], r)]));
  } else {
    const { realNode } = require('./real');
    nodes = {};
    for (const role of ROLES) {
      const cfg = config.lnd[role];
      if (!cfg.socket || !cfg.macaroon || !cfg.cert) {
        const R = role.toUpperCase();
        console.error(`Configuration LND incomplète pour le rôle « ${role} ».`);
        console.error(`Renseignez LND_GRPC_HOST_${R}, LND_MACAROON_BASE64_${R} et LND_TLS_CERT_BASE64_${R} dans backend/.env.`);
        process.exit(1);
      }
      nodes[role] = realNode(cfg);
    }
    const ids = ROLES.map((r) => nodes[r].id);
    if (new Set(ids).size !== ids.length) {
      console.error('Chaque nœud doit avoir un identifiant unique (LND_NODE_ID_*).');
      process.exit(1);
    }
  }
  return nodes;
}

const get = (role) => nodes[role];

/** Retrouve un nœud par rôle (acheteur…) ou par identifiant (alice…). */
function find(ref) {
  if (nodes[ref]) return nodes[ref];
  return Object.values(nodes).find((n) => n.id === ref) || null;
}

/** Exécute un appel LND en traduisant ses erreurs en messages lisibles. */
async function call(promiseOrFn) {
  try {
    return await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (e) {
    throw lnError(e);
  }
}

module.exports = {
  init,
  get,
  find,
  call,
  ROLES,
  get acheteur() { return nodes.acheteur; },
  get vendeur() { return nodes.vendeur; },
  get livreur() { return nodes.livreur; },
  get all() { return ROLES.map((r) => nodes[r]); },
  get network() { return network; },
};
