'use strict';

const net = require('net');
const HashRing = require('../ring/hashRing');

// parsePeer accepts "nodeId:host:port" or "nodeId:port" (host = nodeId for Docker)
function parsePeer(str) {
  const parts = str.split(':');
  if (parts.length === 3) return { nodeId: parts[0], host: parts[1], port: parseInt(parts[2], 10) };
  if (parts.length === 2) return { nodeId: parts[0], host: parts[0], port: parseInt(parts[1], 10) };
  throw new Error('invalid peer format: ' + str);
}

class Replicator {
  constructor(store, nodeId, peerStrs) {
    this._store = store;
    this._nodeId = nodeId;
    this._ring = new HashRing();
    this._ring.addNode(nodeId);
    this._conns = new Map();
    this._peers = new Map();

    for (const str of peerStrs) {
      const peer = parsePeer(str);
      this._peers.set(peer.nodeId, peer);
      this._ring.addNode(peer.nodeId);
      this._connect(peer);
    }
  }

  replicate(key) {
    const replicaId = this._ring.getReplicaNode(key);
    if (!replicaId || replicaId === this._nodeId) return;

    const entry = this._store.getWithTTL(key);
    if (!entry) return;

    const state = this._conns.get(replicaId);
    if (!state || !state.ready) return;

    const ttlMs = Math.max(0, Math.round(entry.remainingTtlMs));
    state.socket.write(`REPLICATE ${key} ${ttlMs} ${entry.value}\n`);
  }

  updatePeers(nodeIds) {
    for (const nodeId of nodeIds) {
      if (nodeId === this._nodeId) continue;
      if (!this._ring.nodes().includes(nodeId)) {
        this._ring.addNode(nodeId);
      }
    }
  }

  updateRing(nodeIds) {
    for (const nodeId of nodeIds) {
      if (!this._ring.nodes().includes(nodeId)) this._ring.addNode(nodeId);
    }
    for (const existing of this._ring.nodes()) {
      if (existing !== this._nodeId && !nodeIds.includes(existing)) {
        this._ring.removeNode(existing);
      }
    }
  }

  ring() {
    return this._ring;
  }

  _connect(peer) {
    const state = { socket: null, ready: false };
    this._conns.set(peer.nodeId, state);

    const connect = () => {
      const socket = net.createConnection({ host: peer.host, port: peer.port });
      socket.setNoDelay(true);
      state.socket = socket;

      socket.on('connect', () => { state.ready = true; });
      socket.on('error', () => { state.ready = false; });
      socket.on('close', () => {
        state.ready = false;
        setTimeout(connect, 3000);
      });
    };

    connect();
  }

  close() {
    for (const [, s] of this._conns) if (s.socket) s.socket.destroy();
  }
}

module.exports = Replicator;
