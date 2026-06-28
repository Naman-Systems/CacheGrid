'use strict';

const { execSync } = require('child_process');
const CacheGridClient = require('../src/client');

const SEEDS = [
  'localhost:7001',
  'localhost:7002',
  'localhost:7003',
];
const TRAFFIC_KEY_COUNT = 100;
const WARMUP_MS = 2000;
const PRE_KILL_MS = 3000;
const GOSSIP_SETTLE_MS = 5000;
const POST_KILL_MS = 5000;
const REJOIN_SETTLE_MS = 6000;

// Graceful fallback: detect if Docker is available
function dockerAvailable() {
  try {
    const env = process.env.DOCKER_HOST ? `DOCKER_HOST=${process.env.DOCKER_HOST} ` : '';
    execSync(env + 'docker ps -q', { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

function dockerExec(cmd) {
  const env = process.env.DOCKER_HOST ? `DOCKER_HOST=${process.env.DOCKER_HOST} ` : '';
  try {
    execSync(env + cmd, { stdio: 'pipe' });
    return true;
  } catch (_) {
    return false;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runChaosTest() {
  console.log('=== CacheGrid Chaos Test ===\n');

  const useDocker = dockerAvailable();
  if (!useDocker) {
    console.log('[!] Docker unavailable — running local-process chaos test instead');
    return runLocalChaos();
  }

  const client = new CacheGridClient({ seeds: SEEDS });

  let totalOps = 0;
  let postKillErrors = 0;
  let postSettleErrors = 0;
  let trackPostKill = false;
  let trackPostSettle = false;
  let running = true;

  // Background traffic loop
  const trafficLoop = async () => {
    while (running) {
      const k = 'chaos:' + (totalOps % TRAFFIC_KEY_COUNT);
      try {
        await client.set(k, 'val' + totalOps, { ttl: 30000 });
        await client.get(k);
        totalOps++;
      } catch (e) {
        if (trackPostSettle) {
          postSettleErrors++;
          console.error('  ERROR (post-settle):', e.message);
        } else if (trackPostKill) {
          postKillErrors++;
        }
      }
    }
  };

  trafficLoop();

  console.log(`[1] Warming up (${WARMUP_MS}ms)...`);
  await sleep(WARMUP_MS);
  console.log(`    ops so far: ${totalOps}`);

  console.log(`\n[2] Running pre-kill traffic (${PRE_KILL_MS}ms)...`);
  await sleep(PRE_KILL_MS);
  const opsBeforeKill = totalOps;
  console.log(`    ops: ${opsBeforeKill}`);

  console.log('\n[3] Killing node2 (docker kill cachegrid-node2)...');
  dockerExec('docker kill cachegrid-node2');
  trackPostKill = true;

  console.log(`[4] Waiting for gossip to detect death (${GOSSIP_SETTLE_MS}ms)...`);
  await sleep(GOSSIP_SETTLE_MS);
  trackPostKill = false;
  trackPostSettle = true;
  const opsAfterGossip = totalOps;
  console.log(`    ops: ${opsAfterGossip}, errors during gossip window: ${postKillErrors}`);

  console.log(`\n[5] Verifying zero errors post-detection (${POST_KILL_MS}ms)...`);
  await sleep(POST_KILL_MS);
  const opsAfterKill = totalOps;
  console.log(`    ops: ${opsAfterKill}, errors post-settle: ${postSettleErrors}`);

  console.log('\n[6] Restarting node2 (docker start cachegrid-node2)...');
  dockerExec('docker start cachegrid-node2');

  console.log(`[7] Waiting for node2 to rejoin (${REJOIN_SETTLE_MS}ms)...`);
  await sleep(REJOIN_SETTLE_MS);
  const opsAfterRejoin = totalOps;
  console.log(`    ops: ${opsAfterRejoin}, errors post-settle: ${postSettleErrors}`);

  running = false;
  client.close();

  console.log('\n=== Results ===');
  console.log(`Total ops:             ${totalOps}`);
  console.log(`Errors (gossip window): ${postKillErrors}  (acceptable — detection in progress)`);
  console.log(`Errors (post-settle):   ${postSettleErrors}  (must be 0)`);

  const passed = postSettleErrors === 0;
  console.log(`\n${passed ? '✓ PASS' : '✗ FAIL'} — chaos test ${passed ? 'passed' : 'FAILED'}`);
  process.exit(passed ? 0 : 1);
}

// Local-process chaos test (no Docker)
async function runLocalChaos() {
  const { spawn } = require('child_process');

  const spawnNode = (id, port, peers) => spawn(
    process.execPath,
    ['src/node/index.js'],
    {
      env: { ...process.env, NODE_ID: id, PORT: String(port), PEERS: peers },
      stdio: 'pipe',
    }
  );

  const LOCAL_SEEDS = ['localhost:7021', 'localhost:7022', 'localhost:7023'];
  const n1 = spawnNode('node1', 7021, 'node2:localhost:7022,node3:localhost:7023');
  const n2 = spawnNode('node2', 7022, 'node1:localhost:7021,node3:localhost:7023');
  const n3 = spawnNode('node3', 7023, 'node1:localhost:7021,node2:localhost:7022');

  await sleep(800);

  const client = new CacheGridClient({ seeds: LOCAL_SEEDS });
  let totalOps = 0, postKillErrors = 0, postSettleErrors = 0;
  let trackPostKill = false, trackPostSettle = false, running = true;

  const trafficLoop = async () => {
    while (running) {
      const k = 'chaos:' + (totalOps % 100);
      try {
        await client.set(k, 'val' + totalOps, { ttl: 30000 });
        await client.get(k);
        totalOps++;
      } catch (e) {
        if (trackPostSettle) { postSettleErrors++; console.error('  ERROR:', e.message); }
        else if (trackPostKill) postKillErrors++;
      }
    }
  };

  trafficLoop();

  console.log('[1] Warming up (2s)...');
  await sleep(2000);
  console.log('    ops:', totalOps);

  console.log('\n[2] Killing node2...');
  n2.kill('SIGKILL');
  trackPostKill = true;

  console.log('[3] Waiting for gossip (5s)...');
  await sleep(5000);
  trackPostKill = false;
  trackPostSettle = true;
  console.log('    ops:', totalOps, '| errors during gossip window:', postKillErrors);

  console.log('\n[4] Verifying 0 errors post-detect (5s)...');
  await sleep(5000);
  console.log('    ops:', totalOps, '| post-settle errors:', postSettleErrors);

  running = false;
  client.close();
  n1.kill(); n3.kill();

  console.log('\n=== Results ===');
  console.log('Total ops:              ', totalOps);
  console.log('Errors (gossip window): ', postKillErrors, ' (acceptable)');
  console.log('Errors (post-settle):   ', postSettleErrors, ' (must be 0)');

  const passed = postSettleErrors === 0;
  console.log(`\n${passed ? '✓ PASS' : '✗ FAIL'} — chaos test ${passed ? 'passed' : 'FAILED'}`);
  process.exit(passed ? 0 : 1);
}

runChaosTest().catch(e => { console.error(e); process.exit(1); });
