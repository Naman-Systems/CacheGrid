'use strict';

const net = require('net');

class Rebalance {
  constructor(store, ring, nodeId, peerMap) {
    this._store = store;
    this._ring = ring;
    this._nodeId = nodeId;
    this._peerMap = peerMap; // Map<nodeId, { host, port }>
  }

  run() {
    const keys = this._store.keys();
    for (const key of keys) {
      const owner = this._ring.getNode(key);
      if (owner && owner !== this._nodeId) {
        this._migrate(key, owner);
      }
    }
  }

  _migrate(key, targetNodeId) {
    const entry = this._store.getWithTTL(key);
    if (!entry) return;

    const peer = this._peerMap.get(targetNodeId);
    if (!peer) return;

    const ttlMs = Math.max(0, Math.round(entry.remainingTtlMs));
    const cmd = `MIGRATE ${key} ${ttlMs} ${entry.value}\n`;

    const socket = net.createConnection({ host: peer.host, port: peer.port });
    socket.setNoDelay(true);
    let done = false;

    socket.on('connect', () => socket.write(cmd));
    socket.on('data', (chunk) => {
      if (!done && chunk.toString().includes('OK')) {
        done = true;
        this._store.del(key);
        socket.destroy();
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {});
    setTimeout(() => { if (!done) socket.destroy(); }, 2000);
  }
}

module.exports = Rebalance;
