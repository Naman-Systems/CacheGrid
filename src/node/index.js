'use strict';

const net = require('net');
const Store = require('./store');
const Protocol = require('./protocol');
const Replicator = require('./replicator');

const NODE_ID = process.env.NODE_ID || 'node1';
const PORT = parseInt(process.env.PORT || '7001', 10);
const PEERS = (process.env.PEERS || '').split(',').map(s => s.trim()).filter(Boolean);

const store = new Store();
const replicator = new Replicator(store, NODE_ID, PEERS);
const protocol = new Protocol(store, replicator);

const server = net.createServer((socket) => {
  socket.setNoDelay(true);
  protocol.attach(socket);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${NODE_ID}] listening on :${PORT} peers=${PEERS.join(',') || 'none'}`);
});

server.on('error', (err) => {
  console.error(`[${NODE_ID}] server error:`, err.message);
  process.exit(1);
});

function close() {
  store.close();
  replicator.close();
  server.close();
}

module.exports = { close };
