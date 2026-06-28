'use strict';

const net = require('net');
const HashRing = require('../ring/hashRing');

const REQUEST_TIMEOUT_MS = 500;
const RECONNECT_INTERVAL_MS = 3000;

// parseSeed: "host:port" → { nodeId: "host:port", host, port }
function parseSeed(addr) {
  const [host, port] = addr.split(':');
  return { nodeId: addr, host, port: parseInt(port, 10) };
}

class CacheGridClient {
  constructor({ seeds }) {
    this._ring = new HashRing();
    this._conns = new Map();
    this._dead = new Set();
    this._closed = false;

    for (const addr of (seeds || [])) {
      const { nodeId, host, port } = parseSeed(addr);
      this._ring.addNode(nodeId);
      this._openConnection(nodeId, host, port);
    }

    this._reconnectTimer = setInterval(() => this._reconnectDead(), RECONNECT_INTERVAL_MS);
    this._reconnectTimer.unref();
  }

  async set(key, value, { ttl = 0 } = {}) {
    await this._send(key, `SET ${key} ${ttl} ${value}`);
  }

  async get(key) {
    const raw = await this._send(key, `GET ${key}`);
    if (!raw || raw === 'NULL') return null;
    if (raw.startsWith('VALUE ')) return raw.slice(6);
    return null;
  }

  async del(key) {
    await this._send(key, `DEL ${key}`);
  }

  close() {
    this._closed = true;
    clearInterval(this._reconnectTimer);
    for (const [, s] of this._conns) s.socket.destroy();
  }

  // ── internals ────────────────────────────────────────────────────────────

  _send(key, cmd, retried = false) {
    const nodeId = this._ring.getNode(key);
    if (!nodeId) return Promise.reject(new Error('no live nodes in ring'));

    const state = this._conns.get(nodeId);
    if (!state) {
      if (!retried) return this._failover(key, cmd, nodeId);
      return Promise.reject(new Error(`no connection for ${nodeId}`));
    }

    return new Promise((resolve, reject) => {
      const enqueue = () => {
        if (this._dead.has(nodeId)) {
          if (!retried) return this._failover(key, cmd, nodeId).then(resolve, reject);
          return reject(new Error(`${nodeId} is dead`));
        }

        const timer = setTimeout(() => {
          state.queue.shift();
          this._markDead(nodeId);
          if (!retried) this._failover(key, cmd, nodeId).then(resolve, reject);
          else reject(new Error(`timeout on ${nodeId}`));
        }, REQUEST_TIMEOUT_MS);

        state.queue.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });

        state.socket.write(cmd + '\n');
      };

      if (state.ready) enqueue();
      else state.pending.push(enqueue);
    });
  }

  _failover(key, cmd, deadId) {
    this._markDead(deadId);
    const next = this._ring.getNode(key);
    if (!next) return Promise.reject(new Error('no live node available for key'));
    return this._send(key, cmd, true);
  }

  _markDead(nodeId) {
    if (this._dead.has(nodeId)) return;
    this._dead.add(nodeId);
    this._ring.removeNode(nodeId);
    const state = this._conns.get(nodeId);
    if (state) {
      state.ready = false;
      state.socket.destroy();
      const err = new Error(`${nodeId} is dead`);
      while (state.queue.length) state.queue.shift()(null, err);
      while (state.pending.length) state.pending.shift()();
    }
  }

  _openConnection(nodeId, host, port) {
    const state = { socket: null, ready: false, queue: [], pending: [], buffer: '' };
    this._conns.set(nodeId, state);

    const socket = net.createConnection({ host, port });
    socket.setNoDelay(true);
    state.socket = socket;

    socket.on('connect', () => {
      this._dead.delete(nodeId);
      if (!this._ring.nodes().includes(nodeId)) this._ring.addNode(nodeId);
      state.ready = true;
      const pending = state.pending.splice(0);
      for (const fn of pending) fn();
    });

    socket.on('data', (chunk) => {
      state.buffer += chunk.toString();
      const lines = state.buffer.split('\n');
      state.buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cb = state.queue.shift();
        if (cb) cb(trimmed);
      }
    });

    const onClose = () => {
      state.ready = false;
      const err = new Error(`connection to ${nodeId} lost`);
      while (state.queue.length) state.queue.shift()(null, err);
    };

    socket.on('error', onClose);
    socket.on('close', onClose);
  }

  _reconnectDead() {
    if (this._closed) return;
    for (const nodeId of [...this._dead]) {
      const [host, port] = nodeId.split(':');
      const probe = net.createConnection({ host, port: parseInt(port, 10) });
      probe.setTimeout(1000);
      probe.on('connect', () => {
        probe.destroy();
        this._dead.delete(nodeId);
        this._ring.addNode(nodeId);
        this._openConnection(nodeId, host, parseInt(port, 10));
      });
      probe.on('error', () => probe.destroy());
      probe.on('timeout', () => probe.destroy());
    }
  }
}

module.exports = CacheGridClient;
