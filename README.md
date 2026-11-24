# CacheGrid

> A distributed in-memory cache cluster built entirely from scratch — no Redis, no Memcached, no external coordination libraries.

Multiple Node.js TCP servers form one logical cache. Consistent hashing distributes keys, async replication survives node failure, gossip detects dead nodes in seconds, and a client SDK hides all of this behind a dead-simple `get` / `set` / `del` interface.

---

## What Makes This Different

Most cache tutorials show you how to *call* Redis. CacheGrid shows you what's *underneath* — every subsystem hand-rolled:

| Subsystem | What it does |
|---|---|
| **Consistent hashing** | 150 virtual nodes per physical node, MD5-based ring, O(log N) lookup |
| **Wire protocol** | Plain-text TCP, one command per line — debuggable with `nc` |
| **Replication** | Primary writes async-replicate to the next clockwise node |
| **Gossip** | Heartbeat every 1s, 3 missed pings → DEAD, propagated to all peers |
| **Client failover** | Dead node detected → ring rebuilt → retry on replica, transparent to caller |
| **Rebalancing** | Node joins/leaves → only affected key range migrates (~1/N of keys) |
| **TTL on replicas** | Remaining TTL propagated, not full TTL — replicas expire at the same wall-clock time |
| **Chaos test** | Live traffic + `kill -9` a node mid-flight → asserts zero errors post-detection |

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │        Application           │
                    │   c.set('key', 'val', {ttl}) │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       CacheGridClient        │
                    │  HashRing.getNode(key)       │
                    │  persistent TCP pool         │
                    │  failover → replica retry    │
                    └──┬─────────────┬────────────┘
                       │             │
              ┌────────▼──┐     ┌────▼──────┐     ┌───────────┐
              │  node1    │     │  node2    │     │  node3    │
              │  :7001    │◄────►  :7002    │◄────►  :7003    │
              │           │  gossip + repl  │           │
              │  Store    │     │  Store    │     │  Store    │
              │  HashRing │     │  HashRing │     │  HashRing │
              └───────────┘     └───────────┘     └───────────┘
```

**Request flow (SET):**
1. Client hashes key → picks node via ring → sends `SET key ttl value\n` over persistent TCP
2. Node stores in-memory, replies `OK\n`
3. Node async-sends `REPLICATE key remainingTtl value\n` to next clockwise node
4. Client returns — replica write happens in background

**Failure flow (node dies):**
1. Gossip misses 3 pings (3 seconds) → marks peer DEAD
2. Client TCP error → node removed from local ring → request retried on replica
3. Surviving nodes run rebalance → orphaned keys migrate to new owners

---

## Wire Protocol

Plain text over TCP. One command per line. Debuggable with `nc localhost 7001`.

```
SET   <key> <ttl_ms> <value>      →  OK
GET   <key>                       →  VALUE <value>  |  NULL
DEL   <key>                       →  OK
PING                              →  PONG
REPLICATE <key> <ttl_ms> <value>  →  (no reply — fire and forget)
MIGRATE   <key> <ttl_ms> <value>  →  OK
PEERS     <nodeId ...>            →  (peer list update — no reply)
RING_UPDATE <nodeId ...>          →  (ring change notification — no reply)
```

---

## Quick Start

**Option A — Docker Compose (3 real nodes):**
```bash
docker compose up -d
node -e "
const C = require('./src/client');
const c = new C({ seeds: ['localhost:7001','localhost:7002','localhost:7003'] });
c.set('hello', 'world', { ttl: 60000 }).then(() => c.get('hello')).then(console.log);
"
```

**Option B — Local processes:**
```bash
NODE_ID=node1 PORT=7001 PEERS=node2:localhost:7002,node3:localhost:7003 node src/node/index.js &
NODE_ID=node2 PORT=7002 PEERS=node1:localhost:7001,node3:localhost:7003 node src/node/index.js &
NODE_ID=node3 PORT=7003 PEERS=node1:localhost:7001,node2:localhost:7002 node src/node/index.js &
```

**Run the chaos test:**
```bash
node scripts/chaos_test.js
# 1600+ ops, kills node mid-flight, asserts 0 errors post-detection
```

For full setup and deployment instructions see **[SETUP.md](SETUP.md)** and **[DEPLOYMENT.md](DEPLOYMENT.md)**.

---

## Project Structure

```
src/
  node/
    index.js        TCP server entry — bootstraps all subsystems
    store.js        In-memory Map with lazy + sweep TTL expiry
    protocol.js     Line-buffered wire protocol parser
    replicator.js   Async replication to replica node on the ring
    gossip.js       Heartbeat loop, missed-ping counter, DEAD/ALIVE events
    rebalance.js    Key migration when ring changes (join / leave)
  ring/
    hashRing.js     Consistent hash ring — virtual nodes, MD5, binary search
  client/
    index.js        CacheGridClient — ring routing, connection pool, failover
scripts/
  chaos_test.js     Traffic + kill + assert zero errors
```

---

## Client SDK

```js
const CacheGridClient = require('./src/client');

const client = new CacheGridClient({
  seeds: ['localhost:7001', 'localhost:7002', 'localhost:7003'],
});

// SET with TTL (milliseconds)
await client.set('session:abc', JSON.stringify(user), { ttl: 1_800_000 });

// GET — returns string or null on miss/expiry
const val = await client.get('session:abc');

// DEL
await client.del('session:abc');

// Cleanup
client.close();
```

The client handles everything transparently:
- Routes each key to the correct node via consistent hashing
- Detects connection failures and retries on the replica node
- Reconnects to recovered nodes every 3 seconds
- Queues requests until the TCP connection is established

---

## Key Design Decisions

**Why consistent hashing over `key_hash % N`?**
Modulo hashing remaps ~all keys when N changes. Consistent hashing remaps only ~1/N of keys. With 3 nodes and 150 vnodes each, adding a 4th node moves ~25% of keys instead of ~75%.

**Why plain-text TCP over HTTP/gRPC?**
Zero framing overhead, zero dependencies, debuggable with `telnet`. Values cannot contain newlines — acceptable for a cache prototype.

**Why async replication?**
Primary returns `OK` before the replica ACKs. Halves write latency. Trade-off: a write lost if the primary crashes between `OK` and the replica receiving `REPLICATE`. Acceptable for a cache (AP on the CAP spectrum).

**Why gossip instead of a central coordinator?**
No single point of failure. Each node monitors all peers directly — O(N²) messages but N is small (3–10). Full gossip protocols fan out to K random peers to cap this at O(N log N).

---

## CAP Theorem Position

CacheGrid is **AP** — Available + Partition-tolerant.

During a network partition, both sides continue serving reads and writes (available) but may diverge (not consistent). When the partition heals, gossip restores the ring view. Last-write-wins semantics — no vector clocks, no conflict resolution.

This is the correct trade-off for a cache: a slightly stale hit is always better than a cache miss that falls through to a slow database.

---

## Chaos Test Results

```
=== CacheGrid Chaos Test ===

[1] Warming up (2s)...           ops: 1653
[2] Running pre-kill traffic...  ops: 1657
[3] Killing node2...
[4] Waiting for gossip (5s)...   errors during detection window: 0
[5] Verifying post-detect (5s).. errors post-settle: 0

=== Results ===
Total ops:              1657
Errors (gossip window):  0
Errors (post-settle):    0

✓ PASS — chaos test passed
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 | Single-threaded event loop — no mutex needed for store ops |
| Transport | `net` module (raw TCP) | Zero-overhead, fully async, no HTTP framing |
| Hashing | `crypto.md5` (built-in) | Fast, uniform distribution, no deps |
| Container | Docker + Docker Compose | Realistic multi-node simulation locally |
| No external libs | Intentional | Every subsystem is visible and explainable |

---

## Limitations and Future Improvements

CacheGrid is currently a learning project and prototype. Possible future improvements include:

- **Durability:** Add optional disk persistence or snapshots so node restarts do not lose all local data.
- **Reliable replication:** Acknowledge replica writes, retry failed replication, and replicate deletions. The current write replication is asynchronous and does not confirm that the replica stored the value.
- **Failure recovery:** Improve dead-node probing and ring convergence so recovered nodes are reliably detected and safely rejoin the cluster.
- **Conflict handling:** Define consistent behavior for concurrent writes during network partitions, such as versioning or an explicit conflict-resolution policy.
- **Safer protocol:** Add input validation and robust message framing, then support values and keys containing arbitrary characters.
- **Security:** Add authentication and encrypted connections before considering use on untrusted networks.
- **Stronger testing and operations:** Test returned values and data consistency during failures, and add metrics, structured logs, and health endpoints.
- **Scale testing:** Benchmark larger clusters and workloads; the current peer monitoring and design target small clusters.
