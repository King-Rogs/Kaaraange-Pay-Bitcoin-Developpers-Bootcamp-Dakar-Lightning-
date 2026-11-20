'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.BTC_MODE = 'mock'; process.env.LND_MODE = 'mock';
const config = require('../src/config');
const bitcoin = require('../src/bitcoin');
test('minage lent : délai dédié et réponse ambiguë signalée sans faux diagnostic de panne', async () => {
  let delay = 40;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const b of req) text += b;
    const data = JSON.parse(text); let result;
    if (data.method === 'getblockchaininfo') result = { chain: 'regtest' };
    else if (data.method === 'listwallets') result = ['test'];
    else if (data.method === 'getnewaddress') result = 'bcrt1qtest';
    else if (data.method === 'generatetoaddress') { await new Promise(r => setTimeout(r, delay)); result = ['block']; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result, error: null }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const old = { mode: config.btcMode, rpc: config.btcRpc, timeout: config.btcMineTimeoutMs };
  try {
    config.btcMode = 'rpc'; config.btcRpc = { url: `http://127.0.0.1:${server.address().port}`, user: 'test', pass: 'test' }; bitcoin.init();
    config.btcMineTimeoutMs = 200;
    assert.deepEqual((await bitcoin.chain.mine('test', 1)).hashes, ['block']);
    config.btcMineTimeoutMs = 10; delay = 100;
    await assert.rejects(bitcoin.chain.mine('test', 1), error => error.status === 504 && /peut encore aboutir/.test(error.message));
  } finally { config.btcMode = old.mode; config.btcRpc = old.rpc; config.btcMineTimeoutMs = old.timeout; server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
