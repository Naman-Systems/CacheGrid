# CacheGrid

A distributed in-memory cache cluster built from scratch.

Multiple Node.js TCP servers form one logical cache — consistent hashing distributes keys, replication survives node failure, gossip detects dead nodes automatically, and a client SDK hides all of this behind a simple GET/SET/DEL interface.

## Stack

- Node.js — cache nodes (TCP servers) + client SDK
- TCP sockets (`net` module) — node-to-node and client-to-node communication
- Docker Compose — each container is one cache node
- No Redis, no external cache library, no consistent-hashing npm package

## How to Run

```bash
docker-compose up -d        # starts node1 (:7001), node2 (:7002), node3 (:7003)

# test with client SDK
node -e "
const CacheGridClient = require('./src/client');
const c = new CacheGridClient({ seeds: ['localhost:7001'] });
c.set('foo', 'bar', { ttl: 5000 }).then(() => c.get('foo')).then(console.log);
"

# run chaos test
node scripts/chaos_test.js
```

## Architecture

- **Consistent hashing** with virtual nodes distributes keys evenly across nodes
- **Replication** — each write is asynchronously replicated to a replica node
- **Gossip protocol** — nodes exchange heartbeats; three missed pings marks a peer dead
- **Client-side failover** — client detects dead node, rebuilds ring, retries on replica
- **Rebalancing** — when a node joins/leaves, only the affected key range migrates

## Wire Protocol

Plain text over TCP, one command per line:

```
SET <key> <ttl_ms> <value>\n
GET <key>\n
DEL <key>\n
PING\n
PEERS <node1> <node2> ...\n
REPLICATE <key> <ttl_ms> <value>\n
RING_UPDATE <node1> <node2> ...\n
MIGRATE <key> <ttl_ms> <value>\n
```
