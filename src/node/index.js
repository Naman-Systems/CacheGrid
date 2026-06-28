'use strict';

const net = require('net');
const Store = require('./store');
const Protocol = require('./protocol');
const Replicator = require('./replicator');
const Gossip = require('./gossip');
const Rebalance = require('./rebalance');

const NODE_ID = process.env.NODE_ID || 'node1';
const PORT = parseInt(process.env.PORT || '7001', 10);
const PEERS = (process.env.PEERS || '').split(',').map(s => s.trim()).filter(Boolean);

const store = new Store();
const replicator = new Replicator(store, NODE_ID, PEERS);
const protocol = new Protocol(store, replicator);

// Build a nodeId → { host, port } map for rebalance migrations
const peerMap = new Map();
for (const str of PEERS) {
  const parts = str.split(':');
  if (parts.length === 3) peerMap.set(parts[0], { host: parts[1], port: parseInt(parts[2], 10) });
  else if (parts.length === 2) peerMap.set(parts[0], { host: parts[0], port: parseInt(parts[1], 10) });
}

const gossip = new Gossip(
  NODE_ID,
  PEERS,
  (deadId) => {
    replicator.ring().removeNode(deadId);
    const rebalance = new Rebalance(store, replicator.ring(), NODE_ID, peerMap);
    rebalance.run();
  },
  (aliveId, peer) => {
    replicator.ring().addNode(aliveId);
    if (!peerMap.has(aliveId)) peerMap.set(aliveId, { host: peer.host, port: peer.port });
    const rebalance = new Rebalance(store, replicator.ring(), NODE_ID, peerMap);
    rebalance.run();
  }
);

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
  gossip.close();
  server.close();
}

module.exports = { close };
