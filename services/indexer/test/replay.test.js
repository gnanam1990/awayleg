// T-008 Replay and restart: logs out of order and twice, interrupt before
// cursor commit, restart and re-index, standings equal a clean rescan.
// Includes draw, win, dispute and expiry fixtures.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDeployment, getCursor, openDb } from '../src/db.js';
import { listFixtures, listSlots, standings } from '../src/project.js';
import { FakeChain, fakeLog } from '../src/source.js';
import { syncDeployment } from '../src/worker.js';


const ADDR = '0x00000000000000000000000000000000aaaabbbb';
const HOME = '0x00000000000000000000000000000000e111e111';
const AWAY = '0x00000000000000000000000000000000e222e222';
const HOME_CAP = '0x00000000000000000000000000000000ca11ca11';
const AWAY_CAP = '0x00000000000000000000000000000000ca22ca22';
const COURSE = '0x3de7c3c6dfc61070fbaa0fc30ef3bbd01741ccb7a31492fa72bcf9ad9cbb5c95';
const REPLAY = '0x5bc5556fe729bd9809d6e2b772870009b11441e5c7a50bc5295d4640ce53e5ac';
const REPLAY2 = '0x' + '11'.repeat(32);

function fixtureLog(id, key) {
  return fakeLog(ADDR, 'FixtureCreated', {
    id: BigInt(id),
    scheduleKey: key,
    homeEntrant: HOME,
    awayEntrant: AWAY,
    homeCaptain: HOME_CAP,
    awayCaptain: AWAY_CAP,
    courseHash: COURSE,
    entryClose: BigInt(1_700_000_100),
    attestClose: BigInt(1_700_000_200),
  });
}

function lockLog(id, slot, entrant, order) {
  return fakeLog(ADDR, 'StrategyLocked', {
    id: BigInt(id),
    slot,
    entrant,
    order,
  });
}

function attestLog(id, captain, tuple) {
  return fakeLog(ADDR, 'Attested', {
    id: BigInt(id),
    captain,
    replayHash: tuple[0],
    homeDelivered: tuple[1],
    homeTurns: tuple[2],
    awayDelivered: tuple[3],
    awayTurns: tuple[4],
  });
}

function acceptedLog(id, outcome, tuple) {
  return fakeLog(ADDR, 'Accepted', {
    id: BigInt(id),
    outcome,
    replayHash: tuple[0],
    homeDelivered: tuple[1],
    homeTurns: tuple[2],
    awayDelivered: tuple[3],
    awayTurns: tuple[4],
  });
}

function disputedLog(id, homeTuple, awayTuple) {
  return fakeLog(ADDR, 'Disputed', {
    id: BigInt(id),
    homeReport: {
      replayHash: homeTuple[0],
      homeDelivered: homeTuple[1],
      homeTurns: homeTuple[2],
      awayDelivered: homeTuple[3],
      awayTurns: homeTuple[4],
    },
    awayReport: {
      replayHash: awayTuple[0],
      homeDelivered: awayTuple[1],
      homeTurns: awayTuple[2],
      awayDelivered: awayTuple[3],
      awayTurns: awayTuple[4],
    },
  });
}

function expiredLog(id) {
  return fakeLog(ADDR, 'Expired', { id: BigInt(id) });
}

const key = (n) => '0x' + n.toString(16).padStart(64, '0');

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'awayleg-idx-'));
  const dbPath = join(dir, 'index.db');
  const db = openDb(dbPath);
  const chain = new FakeChain(31337);
  const deploymentId = ensureDeployment(db, { chainId: 31337, address: ADDR, startBlock: 0 });
  return { db, chain, deploymentId, dbPath, dir };
}

function sync(db, chain, deploymentId, opts = {}) {
  return syncDeployment(db, chain, deploymentId, { address: ADDR, backoffMs: 1, ...opts });
}

describe('T-008 replay and restart', () => {
  it('projects win/draw/dispute/expiry from finalized logs in order', async () => {
    const { db, chain, deploymentId } = setup();
    chain.mineBlock([]); // block 0 = deployment
    chain.mineBlock([fixtureLog(1, key(1))]);
    chain.mineBlock([
      lockLog(1, 0, HOME, [0, 1, 2, 3, 4]),
      lockLog(1, 1, AWAY, [4, 3, 2, 1, 0]),
    ]);
    const tuple = [REPLAY, 5, 5, 5, 9];
    chain.mineBlock([attestLog(1, HOME_CAP, tuple)]);
    chain.mineBlock([attestLog(1, AWAY_CAP, tuple), acceptedLog(1, 1, tuple)]);
    // fixture 2: draw
    chain.mineBlock([fixtureLog(2, key(2))]);
    chain.mineBlock([lockLog(2, 0, HOME, [0, 1, 2, 3, 4]), lockLog(2, 1, AWAY, [0, 1, 2, 3, 4])]);
    const drawTuple = [REPLAY2, 5, 9, 5, 9];
    chain.mineBlock([attestLog(2, HOME_CAP, drawTuple)]);
    chain.mineBlock([attestLog(2, AWAY_CAP, drawTuple), acceptedLog(2, 3, drawTuple)]);
    // fixture 3: dispute
    chain.mineBlock([fixtureLog(3, key(3))]);
    chain.mineBlock([lockLog(3, 0, HOME, [0, 1, 2, 3, 4]), lockLog(3, 1, AWAY, [4, 3, 2, 1, 0])]);
    const otherTuple = [REPLAY, 4, 9, 5, 9];
    chain.mineBlock([attestLog(3, HOME_CAP, tuple)]);
    chain.mineBlock([attestLog(3, AWAY_CAP, otherTuple), disputedLog(3, tuple, otherTuple)]);
    // fixture 4: expiry
    chain.mineBlock([fixtureLog(4, key(4))]);
    chain.mineBlock([expiredLog(4)]);

    const r = await sync(db, chain, deploymentId);
    assert.equal(r.advanced, true);
    const s = standings(db, deploymentId);
    assert.equal(s.home, 4); // win 3 + draw 1
    assert.equal(s.away, 1); // draw 1
    assert.equal(s.accepted, 2);
    assert.deepEqual(s.counts, { Accepted: 2, Disputed: 1, Expired: 1 });
    const fixtures = listFixtures(db, deploymentId);
    assert.equal(fixtures.length, 4);
    assert.equal(fixtures[0].outcome, 'HomeWin');
    assert.equal(fixtures[1].outcome, 'Draw');
    assert.equal(fixtures[2].state, 'Disputed');
    assert.equal(fixtures[3].state, 'Expired');
    const slots = listSlots(db, deploymentId, 1);
    assert.deepEqual(slots[0].lockedOrder, [0, 1, 2, 3, 4]);
    assert.deepEqual(slots[1].lockedOrder, [4, 3, 2, 1, 0]);
  });

  it('dedupes duplicate deliveries and sorts out-of-order logs', async () => {
    const { db, chain, deploymentId } = setup();
    chain.mineBlock([]);
    chain.mineBlock([fixtureLog(1, key(1))]);
    const tuple = [REPLAY, 5, 5, 5, 9];
    chain.mineBlock([
      lockLog(1, 0, HOME, [0, 1, 2, 3, 4]),
      lockLog(1, 1, AWAY, [4, 3, 2, 1, 0]),
    ]);
    chain.mineBlock([attestLog(1, HOME_CAP, tuple)]);
    chain.mineBlock([attestLog(1, AWAY_CAP, tuple), acceptedLog(1, 1, tuple)]);
    // Scramble delivered order — the worker sorts by block/tx/log.
    const tail = chain.logs.splice(1);
    tail.reverse();
    chain.logs.push(...tail);
    // duplicate deliveries
    chain.logs.push(tail[0], tail[0]);
    const r = await sync(db, chain, deploymentId);
    assert.equal(r.advanced, true);
    const fixtures = listFixtures(db, deploymentId);
    assert.equal(fixtures.length, 1);
    assert.equal(fixtures[0].state, 'Accepted');
    assert.equal(fixtures[0].outcome, 'HomeWin');
    const s = standings(db, deploymentId);
    assert.equal(s.home, 3);
    assert.equal(s.distinctLockedEntrants, 2);
  });

  it('interrupts mid-sync before cursor commit, then resumes cleanly', async () => {
    const { db, chain, deploymentId, dbPath } = setup();
    chain.mineBlock([]);
    chain.mineBlock([fixtureLog(1, key(1))]);
    const tuple = [REPLAY, 5, 5, 5, 9];
    chain.mineBlock([lockLog(1, 0, HOME, [0, 1, 2, 3, 4]), lockLog(1, 1, AWAY, [4, 3, 2, 1, 0])]);
    chain.mineBlock([attestLog(1, HOME_CAP, tuple)]);
    chain.mineBlock([attestLog(1, AWAY_CAP, tuple), acceptedLog(1, 1, tuple)]);

    // Crash on every fetch after the first committed range: range 0..1
    // committed, cursor parked at its tip while retries exhaust.
    const realGetLogs = chain.getLogs.bind(chain);
    let calls = 0;
    chain.getLogs = async (a, lo, hi) => {
      calls++;
      if (calls > 1) throw new Error('simulated crash mid-sync');
      return realGetLogs(a, lo, hi);
    };
    const r1 = await sync(db, chain, deploymentId, { maxRange: 2 });
    assert.equal(r1.stale, true);
    assert.match(r1.reason, /log-fetch-failed/);
    const midCursor = getCursor(db, deploymentId);
    assert.equal(midCursor.number, 1);
    assert.equal(listFixtures(db, deploymentId).length, 1);
    assert.equal(listFixtures(db, deploymentId)[0].state, 'Open');

    // Resume after restart — result equals a clean single-shot rescan.
    chain.getLogs = realGetLogs;
    db.close();
    const db2 = openDb(dbPath);
    const r2 = await sync(db2, chain, deploymentId, { maxRange: 2 });
    assert.equal(r2.advanced, true);
    const resumed = standings(db2, deploymentId);

    const { db: db3, chain: chain3, deploymentId: dep3 } = setup();
    chain3.mineBlock([]);
    chain3.mineBlock([fixtureLog(1, key(1))]);
    chain3.mineBlock([lockLog(1, 0, HOME, [0, 1, 2, 3, 4]), lockLog(1, 1, AWAY, [4, 3, 2, 1, 0])]);
    chain3.mineBlock([attestLog(1, HOME_CAP, tuple)]);
    chain3.mineBlock([attestLog(1, AWAY_CAP, tuple), acceptedLog(1, 1, tuple)]);
    await sync(db3, chain3, dep3);
    const clean = standings(db3, dep3);
    assert.deepEqual(resumed, clean);
    db2.close();
    db3.close();
  });

  it('restart and re-index matches a clean rescan', async () => {
    const { db, chain, deploymentId, dbPath } = setup();
    chain.mineBlock([]);
    chain.mineBlock([fixtureLog(1, key(1))]);
    chain.mineBlock([lockLog(1, 0, HOME, [0, 1, 2, 3, 4]), lockLog(1, 1, AWAY, [4, 3, 2, 1, 0])]);
    const tuple = [REPLAY, 5, 5, 5, 9];
    chain.mineBlock([attestLog(1, HOME_CAP, tuple)]);
    chain.mineBlock([attestLog(1, AWAY_CAP, tuple), acceptedLog(1, 1, tuple)]);

    const r1 = await sync(db, chain, deploymentId, { maxRange: 2 });
    assert.equal(r1.advanced, true);
    const before = standings(db, deploymentId);

    // "restart": reopen the DB file and resync — must equal clean rescan.
    db.close();
    const db2 = openDb(dbPath);
    const r2 = await sync(db2, chain, deploymentId);
    assert.equal(r2.reason, 'up-to-date');
    const after = standings(db2, deploymentId);
    assert.deepEqual(after, before);
    db2.close();
  });

  it('commits cursor + projections atomically across bounded ranges', async () => {
    const { db, chain, deploymentId } = setup();
    chain.mineBlock([]);
    const tuple = [REPLAY, 5, 5, 5, 9];
    for (let i = 1; i <= 3; i++) {
      chain.mineBlock([fixtureLog(i, key(i))]);
      chain.mineBlock([lockLog(i, 0, HOME, [0, 1, 2, 3, 4]), lockLog(i, 1, AWAY, [4, 3, 2, 1, 0])]);
      chain.mineBlock([attestLog(i, HOME_CAP, tuple), attestLog(i, AWAY_CAP, tuple), acceptedLog(i, 1, tuple)]);
    }
    const r = await sync(db, chain, deploymentId, { maxRange: 3 });
    assert.equal(r.advanced, true);
    const s = standings(db, deploymentId);
    assert.equal(s.accepted, 3);
    assert.equal(s.home, 9);
    const cursor = getCursor(db, deploymentId);
    assert.equal(cursor.number, 9);
  });
});
