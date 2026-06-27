'use strict';

class Store {
  constructor() {
    this._map = new Map();
    this._sweep = setInterval(() => this._expireSweep(), 1000);
    this._sweep.unref();
  }

  set(key, value, ttlMs) {
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : Infinity;
    this._map.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._map.delete(key);
      return null;
    }
    return entry.value;
  }

  getWithTTL(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (now > entry.expiresAt) {
      this._map.delete(key);
      return null;
    }
    return {
      value: entry.value,
      remainingTtlMs: entry.expiresAt === Infinity ? 0 : entry.expiresAt - now,
    };
  }

  del(key) {
    this._map.delete(key);
  }

  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  keys() {
    const now = Date.now();
    const live = [];
    for (const [key, entry] of this._map) {
      if (now <= entry.expiresAt) live.push(key);
    }
    return live;
  }

  size() {
    return this._map.size;
  }

  close() {
    clearInterval(this._sweep);
  }

  _expireSweep() {
    const now = Date.now();
    for (const [key, entry] of this._map) {
      if (now > entry.expiresAt) this._map.delete(key);
    }
  }
}

module.exports = Store;
