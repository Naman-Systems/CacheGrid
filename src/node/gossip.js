'use strict';

const net = require('net');

const PING_INTERVAL_MS = 1000;
const DEAD_THRESHOLD = 3;

// parsePeer: "nodeId:host:port" or "nodeId:port" (host defaults to nodeId)
function parsePeer(str) {
  const parts = str.split(':');
  if (parts.length === 3) return { nodeId: parts[0], host: parts[1], port: parseInt(parts[2], 10) };
  if (parts.length === 2) return { nodeId: parts[0], host: parts[0], port: parseInt(parts[1], 10) };
  throw new Error('invalid peer: ' + str);
}

class Gossip {
  constructor(nodeId, peerStrs, onDead, onAlive) {
    this._nodeId = nodeId;
    this._onDead = onDead || (() => {});
    this._onAlive = onAlive || (() => {});
    this._peers = new Map();

    for (const str of peerStrs) {
      const p = parsePeer(str);
      this._peers.set(p.nodeId, { ...p, missedPings: 0, status: 'ALIVE' });
    }

    this._timer = setInterval(() => this._pingAll(), PING_INTERVAL_MS);
    this._timer.unref();
  }

  addPeer(str) {
    const p = parsePeer(str);
    if (!this._peers.has(p.nodeId)) {
      this._peers.set(p.nodeId, { ...p, missedPings: 0, status: 'ALIVE' });
    }
  }

  livePeers() {
    return [...this._peers.values()].filter(p => p.status === 'ALIVE');
  }

  allPeerIds() {
    return [...this._peers.keys()];
  }

  close() {
    clearInterval(this._timer);
  }

  _pingAll() {
    for (const [nodeId, peer] of this._peers) {
      if (peer.status === 'DEAD') continue;
      this._ping(peer).then((alive) => {
        if (alive) {
          if (peer.missedPings > 0 || peer.status === 'DEAD') {
            peer.missedPings = 0;
            if (peer.status === 'DEAD') {
              peer.status = 'ALIVE';
              console.log(`[${this._nodeId}] ${nodeId} is back ALIVE`);
              this._onAlive(nodeId, peer);
            } else {
              peer.missedPings = 0;
            }
          }
        } else {
          peer.missedPings++;
          if (peer.missedPings >= DEAD_THRESHOLD && peer.status === 'ALIVE') {
            peer.status = 'DEAD';
            console.log(`[${this._nodeId}] ${nodeId} marked DEAD after ${peer.missedPings} missed pings`);
            this._onDead(nodeId, peer);
          }
        }
      });
    }
  }

  _ping(peer) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, PING_INTERVAL_MS - 100);
      const socket = net.createConnection({ host: peer.host, port: peer.port });
      socket.setNoDelay(true);
      let buf = '';

      socket.on('connect', () => socket.write('PING\n'));
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('PONG')) {
          clearTimeout(timer);
          socket.destroy();
          resolve(true);
        }
      });
      socket.on('error', () => { clearTimeout(timer); resolve(false); });
      socket.on('close', () => { clearTimeout(timer); resolve(false); });
    });
  }
}

module.exports = Gossip;
