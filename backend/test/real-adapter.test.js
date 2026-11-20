'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.LND_MODE = 'mock';
process.env.BTC_MODE = 'mock';
const library = require('ln-service');
const config = require('../src/config');
const { realNode } = require('../src/lightning/real');

test('LND figé : réponse bornée sans bloquer la reprise, puis retour à la normale', async () => {
  const oldAuth = library.authenticatedLndGrpc, oldInfo = library.getWalletInfo, oldTimeout = config.lndRpcTimeoutMs;
  library.authenticatedLndGrpc = () => ({ lnd: {} });
  config.lndRpcTimeoutMs = 50;
  try {
    library.getWalletInfo = () => new Promise(() => {});
    const node = realNode({ id: 'test', role: 'vendeur' });
    const start = Date.now();
    await assert.rejects(node.nodeInfo(), error => error[0] === 503);
    assert.ok(Date.now() - start < 1000);
    assert.equal((await node.health()).reachable, false);
    library.getWalletInfo = async () => ({ alias: 'test', public_key: 'test', current_block_height: 115, is_synced_to_chain: true });
    assert.equal((await node.nodeInfo()).synced, true);
    assert.equal((await node.health()).reachable, true);
  } finally { library.authenticatedLndGrpc = oldAuth; library.getWalletInfo = oldInfo; config.lndRpcTimeoutMs = oldTimeout; }
});
