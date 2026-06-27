'use strict';

class Protocol {
  constructor(store) {
    this._store = store;
  }

  attach(socket) {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this._handle(trimmed, socket);
      }
    });

    socket.on('error', () => socket.destroy());
  }

  _handle(line, socket) {
    const spaceIdx = line.indexOf(' ');
    const verb = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

    switch (verb.toUpperCase()) {
      case 'SET': {
        const parts = rest.split(' ');
        const key = parts[0];
        const ttlMs = parseInt(parts[1], 10);
        const value = parts.slice(2).join(' ');
        this._store.set(key, value, ttlMs);
        socket.write('OK\n');
        break;
      }
      case 'GET': {
        const value = this._store.get(rest.trim());
        socket.write(value !== null ? `VALUE ${value}\n` : 'NULL\n');
        break;
      }
      case 'DEL': {
        this._store.del(rest.trim());
        socket.write('OK\n');
        break;
      }
      case 'PING': {
        socket.write('PONG\n');
        break;
      }
      case 'REPLICATE': {
        const parts = rest.split(' ');
        const key = parts[0];
        const ttlMs = parseInt(parts[1], 10);
        const value = parts.slice(2).join(' ');
        this._store.set(key, value, ttlMs);
        break;
      }
      case 'MIGRATE': {
        const parts = rest.split(' ');
        const key = parts[0];
        const ttlMs = parseInt(parts[1], 10);
        const value = parts.slice(2).join(' ');
        this._store.set(key, value, ttlMs);
        socket.write('OK\n');
        break;
      }
      default:
        socket.write('ERROR unknown command\n');
    }
  }
}

module.exports = Protocol;
