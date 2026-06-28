# CacheGrid — Local Setup Guide

This guide walks you through running CacheGrid on your local machine — both with Docker Compose (recommended) and as raw Node.js processes.

---

## Prerequisites

| Requirement | Minimum version | Check |
|---|---|---|
| Node.js | 20.x LTS | `node --version` |
| npm | 9.x | `npm --version` |
| Docker (optional) | 24.x | `docker --version` |
| Docker Compose (optional) | v2 | `docker compose version` |

No npm packages are required — CacheGrid has zero runtime dependencies.

---

## 1. Clone the Repository

```bash
git clone https://github.com/NamanBharsakale/CacheGrid.git
cd CacheGrid
```

---

## 2. Option A — Docker Compose (Recommended)

Docker Compose starts 3 cache nodes in isolated containers, each on the `cachegrid-net` bridge network. Containers resolve each other by name (`node1`, `node2`, `node3`).

### Start the cluster

```bash
docker compose up -d --build
```

Expected output:
```
Container cachegrid-node1  Started
Container cachegrid-node2  Started
Container cachegrid-node3  Started
```

### Verify all nodes are running

```bash
docker compose ps
```

```
NAME              STATUS          PORTS
cachegrid-node1   Up              0.0.0.0:7001->7001/tcp
cachegrid-node2   Up              0.0.0.0:7002->7002/tcp
cachegrid-node3   Up              0.0.0.0:7003->7003/tcp
```

### Verify with a manual ping

```bash
printf 'PING\n' | nc localhost 7001    # PONG
printf 'PING\n' | nc localhost 7002    # PONG
printf 'PING\n' | nc localhost 7003    # PONG
```

### Smoke test with the client SDK

```bash
node -e "
const CacheGridClient = require('./src/client');
const c = new CacheGridClient({
  seeds: ['localhost:7001', 'localhost:7002', 'localhost:7003']
});

async function test() {
  await c.set('greeting', 'hello from CacheGrid', { ttl: 60000 });
  const val = await c.get('greeting');
  console.log('GET greeting:', val);

  await c.del('greeting');
  const gone = await c.get('greeting');
  console.log('GET after DEL:', gone); // null

  c.close();
}
test();
"
```

### Stop the cluster

```bash
docker compose down
```

---

## 3. Option B — Local Node.js Processes

No Docker required. Three processes share `localhost` with different ports.

### Terminal 1 — node1

```bash
NODE_ID=node1 PORT=7001 \
PEERS=node2:localhost:7002,node3:localhost:7003 \
node src/node/index.js
```

### Terminal 2 — node2

```bash
NODE_ID=node2 PORT=7002 \
PEERS=node1:localhost:7001,node3:localhost:7003 \
node src/node/index.js
```

### Terminal 3 — node3

```bash
NODE_ID=node3 PORT=7003 \
PEERS=node1:localhost:7001,node2:localhost:7002 \
node src/node/index.js
```

### Terminal 4 — client

```bash
node -e "
const CacheGridClient = require('./src/client');
const c = new CacheGridClient({
  seeds: ['localhost:7001', 'localhost:7002', 'localhost:7003']
});
c.set('foo', 'bar', { ttl: 5000 }).then(() => c.get('foo')).then(console.log);
"
```

### One-liner (background processes)

```bash
NODE_ID=node1 PORT=7001 PEERS=node2:localhost:7002,node3:localhost:7003 node src/node/index.js &
NODE_ID=node2 PORT=7002 PEERS=node1:localhost:7001,node3:localhost:7003 node src/node/index.js &
NODE_ID=node3 PORT=7003 PEERS=node1:localhost:7001,node2:localhost:7002 node src/node/index.js &
sleep 0.5
node -e "
const c = new (require('./src/client'))({ seeds: ['localhost:7001','localhost:7002','localhost:7003'] });
c.set('x', '42', { ttl: 10000 }).then(() => c.get('x')).then(v => { console.log(v); c.close(); process.exit(); });
"
```

---

## 4. Run the Chaos Test

The chaos test fires live traffic, kills a node mid-flight, and asserts zero errors after gossip detects the failure.

### With Docker (kills and restarts a real container)

```bash
docker compose up -d --build
node scripts/chaos_test.js
```

### Without Docker (uses local processes, kills a process)

```bash
node scripts/chaos_test.js
# Auto-detects no Docker and runs local-process variant
```

Expected output:

```
=== CacheGrid Chaos Test ===

[1] Warming up (2s)...           ops: 1600+
[2] Running pre-kill traffic...
[3] Killing node2...
[4] Waiting for gossip (5s)...   errors during gossip window: 0
[5] Verifying 0 errors (5s)...   post-settle errors: 0

✓ PASS — chaos test passed
```

---

## 5. Manual Protocol Testing

You can talk to a cache node directly with `nc` (netcat):

```bash
# Connect interactively
nc localhost 7001

# Then type commands:
SET user:123 30000 {"name":"Alice"}
GET user:123
DEL user:123
PING
```

Or pipe a batch:

```bash
printf 'SET counter 0 100\nGET counter\nDEL counter\n' | nc localhost 7001
```

---

## 6. Environment Variables Reference

Each cache node is configured entirely through environment variables:

| Variable | Default | Description |
|---|---|---|
| `NODE_ID` | `node1` | Unique identifier used in the hash ring |
| `PORT` | `7001` | TCP port the node listens on |
| `PEERS` | _(empty)_ | Comma-separated peer list: `nodeId:host:port,...` |

### PEERS format

```
PEERS=node2:localhost:7002,node3:localhost:7003
       │     │         │
       │     │         └─ port
       │     └─────────── host (resolvable from this node)
       └───────────────── nodeId (must match NODE_ID of the peer)
```

For Docker, the host equals the service name (Docker DNS resolves it):
```
PEERS=node2:node2:7002,node3:node3:7003
```

---

## 7. Verifying Replication

To confirm a write to the primary is replicated to the replica:

```bash
# Start 3 nodes (local or Docker)
# Write to node1 directly:
printf 'SET mykey 30000 hello\n' | nc localhost 7001

# Wait 50ms for async replication, then check node2:
sleep 0.05
printf 'GET mykey\n' | nc localhost 7002
# → VALUE hello
```

---

## 8. Verifying Gossip Detection

```bash
# Start 3 nodes in background
# Kill node2 (PID or docker):
kill <node2_pid>
# or:
docker kill cachegrid-node2

# Watch node1 and node3 logs — within 3 seconds you should see:
# [node1] node2 marked DEAD after 3 missed pings
# [node3] node2 marked DEAD after 3 missed pings
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `EADDRINUSE` | Port already in use | `lsof -i :7001` to find the process, then kill it |
| `ECONNREFUSED` | Node not started yet | Wait 500ms after start before connecting |
| Client returns `null` for all keys | Seeds not reachable | Confirm nodes are running on the expected ports |
| Docker permission denied | Containers started as root | Use `DOCKER_HOST=unix:///var/run/docker.sock docker compose ...` or run with correct permissions |
| Replica not receiving keys | Replicator connection not yet ready | Add 100–200ms delay after SET before reading replica |
