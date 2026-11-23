// T-009 Chain divergence: replace the checkpoint in a controlled local
// fixture; mark stale, backtrack to a common ancestor, remove orphaned points
// and resume only from a verified finalized checkpoint.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDeployment, getCursor, openDb } from '../src/db.js';
import { listFixtures, standings } from '../src/project.js';
import { FakeChain, fakeLog } from '../src/source.js';
import { syncDeployment } from '../src/worker.js';

const ADDR = '0x00000000000000000000000000000000aaaabbbb';
const HOME = '0x00000000000000000000000000000000e111e111';
const AWAY = '0x00000000000000000000000000000000e222e222';
const HOME_CAP = '0x00000000000000000000000000000000ca11ca11';
const AWAY_CAP = '0x00000000000000000000000000000000ca22ca22';
const COURSE = '0x3de7c3c6dfc61070fbaa0fc30ef3bbd01741ccb7a31492fa72bcf9ad9cbb5c95';
const REPLAY = '0x5bc5556fe729bd9809d6e2b772870009b11441e5c7a50bc5295d4640ce53e5ac';

const key = (n) => '0x' + n.toString(16).padStart(64, '0');
const tuple = [REPLAY, 5, 5, 5, 9];

function fixtureLog(id) {
  return fakeLog(ADDR, 'FixtureCreated', {
    id: BigInt(id),
    scheduleKey: key(id),
    homeEntrant: HOME,
    awayEntrant: AWAY,
    homeCaptain: HOME_CAP,
    awayCaptain: AWAY_CAP,
    courseHash: COURSE,
    entryClose: BigInt(1_700_000_100),
    attestClose: BigInt(1_700_000_200),
  });
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'awayleg-fork-'));
  const db = openDb(join(dir, 'index.db'));
  const chain = new FakeChain(31337);
  const deploymentId = ensureDeployment(db, { chainId: 31337, address: ADDR, startBlock: 0 });
  return { db, chain, deploymentId };
}

describe('T-009 chain divergence', () => {
  it('detects checkpoint mismatch, backtracks, orphans points, resumes', async () => {
    const { db, chain, deploymentId } = setup();
    chain.mineBlock([]); // 0: deployment
    chain.mineBlock([fixtureLog(1)]); // 1
    chain.mineBlock([
      fakeLog(ADDR, 'StrategyLocked', { id: 1n, slot: 0, entrant: HOME, order: [0, 1, 2, 3, 4] }),
      fakeLog(ADDR, 'StrategyLocked', { id: 1n, slot: 1, entrant: AWAY, order: [4, 3, 2, 1, 0] }),
    ]); // 2
    chain.mineBlock([fakeLog(ADDR, 'Attested', { id: 1n, captain: HOME_CAP, replayHash: REPLAY, homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 })]); // 3
    chain.mineBlock([
      fakeLog(ADDR, 'Attested', { id: 1n, captain: AWAY_CAP, replayHash: REPLAY, homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 }),
      fakeLog(ADDR, 'Accepted', { id: 1n, outcome: 1, replayHash: REPLAY, homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 }),
    ]); // 4

    const r1 = await syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1 });
    assert.equal(r1.advanced, true);
    assert.equal(standings(db, deploymentId).home, 3);

    // Reorg: replace block 4 (acceptance) with an empty block on a new fork.
    chain.reorg(4, [[]]);

    const r2 = await syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1 });
    assert.equal(r2.reason, 'divergence-recovered');
    assert.equal(r2.stale, true);
    assert.equal(r2.ancestor.number, 3);
    assert.equal(r2.orphaned, 2); // Attested + Accepted orphaned

    // Orphaned points removed from scoring.
    const s = standings(db, deploymentId);
    assert.equal(s.home, 0);
    assert.equal(s.accepted, 0);
    const fixture = listFixtures(db, deploymentId)[0];
    assert.equal(fixture.state, 'Open');
    assert.equal(fixture.awayReported, false);
    assert.equal(fixture.homeReported, true);
    const cursor = getCursor(db, deploymentId);
    assert.equal(cursor.number, 3);
    assert.equal(cursor.stale, 1);

    // Resume from the verified ancestor: fork grows a real acceptance again.
    chain.mineBlock([
      fakeLog(ADDR, 'Attested', { id: 1n, captain: AWAY_CAP, replayHash: REPLAY, homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 }),
      fakeLog(ADDR, 'Accepted', { id: 1n, outcome: 1, replayHash: REPLAY, homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 }),
    ]); // new block 4
    const r3 = await syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1 });
    assert.equal(r3.advanced, true);
    assert.equal(r3.stale, false);
    assert.equal(standings(db, deploymentId).home, 3);
    assert.equal(listFixtures(db, deploymentId)[0].state, 'Accepted');
  });

  it('marks stale when finality is unavailable', async () => {
    const { db, chain, deploymentId } = setup();
    chain.mineBlock([]);
    const r = await syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1 });
    assert.equal(r.advanced, true);
    // Remove finalized head by breaking the source.
    chain.getFinalizedHead = async () => null;
    const r2 = await syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1 });
    assert.equal(r2.reason, 'finality-unavailable');
    assert.equal(r2.stale, true);
    assert.equal(getCursor(db, deploymentId).stale, 1);
  });
});
