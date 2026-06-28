# CacheGrid — Deployment Guide

This guide covers deploying CacheGrid to production-like environments: a single VM with Docker Compose, a multi-VM cluster, and a cloud-native setup on a VPS.

---

## Deployment Overview

```
                        Internet / LB
                             │
                    ┌────────▼─────────┐
                    │  Reverse Proxy   │
                    │  (nginx / caddy) │
                    │  (optional)      │
                    └──────────────────┘
                             │ (internal network)
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌───────▼───┐  ┌──────▼────┐
     │  node1     │  │  node2    │  │  node3    │
     │  :7001     │  │  :7002    │  │  :7003    │
     │  VM / VPS  │  │  VM / VPS │  │  VM / VPS │
     └────────────┘  └───────────┘  └───────────┘
```

CacheGrid nodes do **not** expose HTTP — clients connect directly to TCP ports. Your application servers must be on the same private network as the cache nodes, or connected over a VPN/tunnel.

---

## Option 1 — Single Host with Docker Compose

Best for: development servers, staging, demos, single-machine setups.

### Step 1 — Prerequisites on the host

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git

# Add your user to the docker group (re-login after)
sudo usermod -aG docker $USER
```

### Step 2 — Clone and configure

```bash
git clone https://github.com/NamanBharsakale/CacheGrid.git
cd CacheGrid
```

### Step 3 — Start the cluster

```bash
docker compose up -d --build
```

### Step 4 — Verify

```bash
docker compose ps
printf 'PING\n' | nc localhost 7001   # PONG
printf 'PING\n' | nc localhost 7002   # PONG
printf 'PING\n' | nc localhost 7003   # PONG
```

### Step 5 — Run the chaos test (optional but recommended)

```bash
node scripts/chaos_test.js
```

### Auto-restart on reboot

Docker Compose does not restart containers by default on reboot. Add a restart policy:

```bash
# Edit docker-compose.yml and add to each service:
#   restart: unless-stopped
```

Or create a systemd unit:

```ini
# /etc/systemd/system/cachegrid.service
[Unit]
Description=CacheGrid distributed cache cluster
Requires=docker.service
After=docker.service

[Service]
WorkingDirectory=/opt/CacheGrid
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cachegrid
```

---

## Option 2 — Multi-VM Cluster (Recommended for Production)

Each node runs on its own VM for true fault isolation. If one host fails, the other two continue serving traffic.

### Infrastructure requirements

| Node | Min spec | Ports to open |
|---|---|---|
| node1 | 1 vCPU, 512 MB RAM | 7001 (internal only) |
| node2 | 1 vCPU, 512 MB RAM | 7002 (internal only) |
| node3 | 1 vCPU, 512 MB RAM | 7003 (internal only) |

> **Security:** Never expose cache ports to the public internet. Use a private VPC/VLAN or firewall rules to restrict port 7001-7003 to your application servers and to other cache nodes only.

### Step 1 — Set up each VM

On each VM, install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

Clone the repository on each VM:

```bash
git clone https://github.com/NamanBharsakale/CacheGrid.git /opt/cachegrid
```

### Step 2 — Create a systemd service on each VM

Replace `<THIS_NODE_ID>`, `<THIS_PORT>`, and `<PEERS_LIST>` for each VM.

```bash
sudo tee /etc/systemd/system/cachegrid-node.service > /dev/null <<EOF
[Unit]
Description=CacheGrid cache node
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/cachegrid
ExecStart=/usr/bin/node src/node/index.js
Restart=on-failure
RestartSec=3

Environment=NODE_ID=<THIS_NODE_ID>
Environment=PORT=<THIS_PORT>
Environment=PEERS=<PEERS_LIST>

[Install]
WantedBy=multi-user.target
EOF
```

**node1** (`10.0.0.1`):
```
NODE_ID=node1
PORT=7001
PEERS=node2:10.0.0.2:7002,node3:10.0.0.3:7003
```

**node2** (`10.0.0.2`):
```
NODE_ID=node2
PORT=7002
PEERS=node1:10.0.0.1:7001,node3:10.0.0.3:7003
```

**node3** (`10.0.0.3`):
```
NODE_ID=node3
PORT=7003
PEERS=node1:10.0.0.1:7001,node2:10.0.0.2:7002
```

### Step 3 — Start each node

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cachegrid-node
sudo systemctl status cachegrid-node
```

### Step 4 — Verify cluster health

From any application server on the same network:

```bash
printf 'PING\n' | nc 10.0.0.1 7001   # PONG
printf 'PING\n' | nc 10.0.0.2 7002   # PONG
printf 'PING\n' | nc 10.0.0.3 7003   # PONG
```

### Step 5 — Connect your application

Install the client SDK by copying `src/client/` and `src/ring/` into your application, or reference them directly from the cloned repo.

```js
const CacheGridClient = require('/opt/cachegrid/src/client');

const cache = new CacheGridClient({
  seeds: ['10.0.0.1:7001', '10.0.0.2:7002', '10.0.0.3:7003'],
});
```

---

## Option 3 — Cloud VPS (DigitalOcean / AWS EC2 / Hetzner)

This mirrors Option 2, using cloud VMs instead of bare metal. The key addition is a firewall rule to restrict cache port access.

### AWS EC2 example

**Security group rules (inbound):**

| Type | Protocol | Port | Source |
|---|---|---|---|
| Custom TCP | TCP | 7001 | App servers SG + other cache nodes |
| Custom TCP | TCP | 7002 | App servers SG + other cache nodes |
| Custom TCP | TCP | 7003 | App servers SG + other cache nodes |
| SSH | TCP | 22 | Your IP only |

**Recommended:** Place all nodes and app servers in the same VPC. Use private IPs in the `PEERS` config.

### DigitalOcean Droplet example

```bash
# After creating 3 Droplets on the same VPC network:
# droplet-1: 10.130.0.1
# droplet-2: 10.130.0.2
# droplet-3: 10.130.0.3

# On droplet-1:
NODE_ID=node1 PORT=7001 \
PEERS=node2:10.130.0.2:7002,node3:10.130.0.3:7003 \
node /opt/cachegrid/src/node/index.js
```

---

## Scaling the Cluster

### Adding a 4th node (zero-downtime)

1. Start node4 with `PEERS` pointing to the existing 3 nodes.
2. On startup, node4 connects to peers, announces itself via gossip.
3. Existing nodes update their rings. Rebalance migrates ~25% of keys to node4.
4. Update `CacheGridClient` seeds in your application to include node4.

```bash
NODE_ID=node4 PORT=7004 \
PEERS=node1:10.0.0.1:7001,node2:10.0.0.2:7002,node3:10.0.0.3:7003 \
node src/node/index.js
```

> **Note:** Currently node4 must be added to the PEERS list of existing nodes for them to connect to it. In the current implementation, nodes only connect to peers listed at startup. A future version will support dynamic peer announcement.

### Removing a node gracefully

1. Remove the node from your application's seed list first (so no new keys route there).
2. Wait ~5 seconds for the client to stop sending traffic.
3. Stop the node process / container.
4. Gossip detects it as DEAD → surviving nodes rebalance its keys automatically.

---

## Production Checklist

### Security
- [ ] Cache ports (7001–7003) are NOT exposed to the public internet
- [ ] Firewall allows cache ports only from app servers and other cache nodes
- [ ] Nodes are on a private VPC/VLAN
- [ ] SSH access is restricted to trusted IPs

### Reliability
- [ ] Nodes run under systemd / Docker `restart: unless-stopped`
- [ ] At least 3 nodes running (maintains replication factor of 2)
- [ ] Chaos test passes against production-equivalent environment

### Monitoring (recommended additions)
- [ ] Log aggregation (ship stdout from all nodes to a central log store)
- [ ] Alert on systemd service restart count exceeding threshold
- [ ] Alert if gossip DEAD events occur more than once per hour per node

### Operational runbook
- [ ] Know how to restart a single node without taking down the cluster
- [ ] Know how to add a node to the ring under live traffic
- [ ] Know which ports to unblock if nodes cannot ping each other

---

## Updating the Cluster (Rolling Restart)

CacheGrid nodes are stateless at restart — all data is in-memory. A restart loses that node's in-memory keys. Replicas on the other two nodes continue serving.

**Safe rolling restart procedure:**

```bash
# Restart node1 — node2 and node3 handle its traffic via gossip failover
sudo systemctl restart cachegrid-node   # on node1

# Wait 5s for gossip to detect the brief outage and recover
sleep 5

# Repeat for node2, then node3
```

---

## Logs

Each node logs to stdout. With systemd:

```bash
journalctl -u cachegrid-node -f
```

With Docker Compose:

```bash
docker compose logs -f
docker compose logs node2    # single node
```

**Log format:**
```
[node1] listening on :7001 peers=node2:localhost:7002,node3:localhost:7003
[node1] node2 marked DEAD after 3 missed pings
[node1] node2 is back ALIVE
```

---

## Version

**v1.0.0** — Initial production-ready release

Features: consistent hashing, async replication, gossip failure detection, client failover, rebalancing, TTL on replicas, chaos test.

See [SETUP.md](SETUP.md) for local development instructions.
