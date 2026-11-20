'use strict';
// Processus uniquement utilisé par le test Polar ; aucune route de test publique.
const { createServer } = require('../src/server');
const ln = require('../src/lightning');
let srv;
let releaseRefund;
(async () => {
  srv = await createServer({ loops: false });
  const server = await srv.listen(0, '127.0.0.1');
  process.send({ event: 'ready', port: server.address().port });
  process.on('message', async message => {
    try {
      if (message.action === 'tick') await srv.tick();
      else if (message.action === 'crash-before-fee') {
        ln.livreur.settle = async () => { process.exit(91); };
      } else if (message.action === 'gate-refund') {
        const pay = ln.vendeur.paySync;
        ln.vendeur.paySync = async (...args) => {
          ln.vendeur.paySync = pay;
          const gate = new Promise(resolve => { releaseRefund = resolve; });
          process.send({ event: 'refund-gated' });
          await gate;
          return pay(...args);
        };
      } else if (message.action === 'release-refund') {
        releaseRefund?.(); releaseRefund = null;
      } else if (message.action === 'stop') { await srv.stop(); process.exit(0); }
      else throw new Error('Commande de test inconnue');
      process.send({ id: message.id, ok: true });
    } catch (error) { process.send({ id: message.id, error: error.message || 'Échec de la commande de test' }); }
  });
})().catch(error => { console.error(error.message); process.exit(1); });
