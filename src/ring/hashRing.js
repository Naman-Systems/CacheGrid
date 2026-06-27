'use strict';

const crypto = require('crypto');

const VIRTUAL_NODES = 150;

function md5Uint32(str) {
  const buf = crypto.createHash('md5').update(str).digest();
  return buf.readUInt32BE(0);
}

class HashRing {
  constructor(vnodeCount) {
    this._vnodes = vnodeCount || VIRTUAL_NODES;
    this._ring = [];
    this._nodeSet = new Set();
  }

  addNode(nodeId) {
    if (this._nodeSet.has(nodeId)) return;
    this._nodeSet.add(nodeId);
    for (let i = 0; i < this._vnodes; i++) {
      const pos = md5Uint32(`${nodeId}#${i}`);
      this._ring.push({ pos, nodeId });
    }
    this._ring.sort((a, b) => a.pos - b.pos);
  }

  removeNode(nodeId) {
    if (!this._nodeSet.has(nodeId)) return;
    this._nodeSet.delete(nodeId);
    this._ring = this._ring.filter((v) => v.nodeId !== nodeId);
  }

  getNode(key) {
    if (this._ring.length === 0) return null;
    const hash = md5Uint32(key);
    let lo = 0;
    let hi = this._ring.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._ring[mid].pos < hash) lo = mid + 1;
      else hi = mid;
    }
    if (this._ring[lo].pos < hash) lo = 0;
    return this._ring[lo].nodeId;
  }

  getReplicaNode(key) {
    if (this._ring.length === 0) return null;
    const primary = this.getNode(key);
    const nodes = [...this._nodeSet];
    if (nodes.length < 2) return null;
    const hash = md5Uint32(key);
    let lo = 0;
    let hi = this._ring.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._ring[mid].pos < hash) lo = mid + 1;
      else hi = mid;
    }
    if (this._ring[lo].pos < hash) lo = 0;
    let idx = lo;
    for (let i = 0; i < this._ring.length; i++) {
      idx = (lo + 1 + i) % this._ring.length;
      if (this._ring[idx].nodeId !== primary) return this._ring[idx].nodeId;
    }
    return null;
  }

  nodes() {
    return [...this._nodeSet];
  }

  size() {
    return this._ring.length;
  }
}

module.exports = HashRing;
