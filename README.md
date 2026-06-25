 Self-Healing Distributed Cache
Small Name: CacheGrid (or HealCache / NodeMesh / ResiliCache)

📌 What It Is

"Build your own Redis cluster: sharded, replicated, survive node failure live"

A distributed cache cluster built from scratch where multiple independent cache nodes form one logical system, use consistent hashing to distribute keys, replicate data across nodes, and automatically detect + recover from node failures — without any downtime for clients.

🚫 Why This Isn't a Generic Project

"Anyone can call SET and GET on Redis. A distributed cache forces you to understand what's underneath: consistent hashing, replica failover, and rebalancing without downtime. This proves you understand distributed systems, not just distributed tools."


✅ Core Requirements
#Requirement01Run as multiple independent cache nodes that together form one logical cache cluster02Use consistent hashing (not modulo hashing) to distribute keys — so adding/removing a node reshuffles a minimal number of keys03Replicate every key to at least one additional node; reads must still succeed if the primary holder of a key goes down04Detect a failed node automatically (heartbeat/gossip) and reroute its traffic without manual intervention05When a failed node returns (or a new node joins), automatically rebalance keys with zero downtime for clients06Support TTL-based expiry that is honored consistently across all replicas of a key07Demonstrate the cluster surviving a live kill of a random node mid-traffic with zero failed client requests (beyond one configurable retry)

🎯 Stretch Goals

Add an LRU/LFU eviction policy under memory pressure, per node
Build a cluster-wide consistency mode (quorum reads/writes) as an optional stricter alternative to eventual consistency


🧠 Skills You'll Master

Consistent hashing
Gossip/failure detection
Replication
Rebalancing
CAP theorem trade-offs


🛠️ Suggested Tech Stack (your style)
ComponentToolLanguageGo (ideal) or Node.jsNode CommunicationTCP sockets / gRPCFailure DetectionHeartbeat + Gossip protocol (custom)Consistent HashingCustom implementation (virtual nodes)Client SDKSimple GET/SET/DEL wrapper libraryTestingChaos test: kill -9 random node mid-loadDeployDocker Compose (multiple containers = multiple nodes)

🗂️ Suggested Project Names
NameVibeCacheGridGrid of distributed cache nodesHealCacheSelf-healing angleNodeMeshMesh of cache nodesResiliCacheResilience + cacheHashRingHighlights the consistent hashing core
Given your naming style, CacheGrid is the strongest — clean, technical, and immediately signals distributed systems depth to any interviewer at a product company or MNC.
