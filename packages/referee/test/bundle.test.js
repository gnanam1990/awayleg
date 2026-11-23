// T-012 disagreement diagnosis + T-013 bundle verification.
// T-011 separate club runners: run the CLI from an unrelated cwd.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildReplay,
  BundleError,
  manifestFor,
  readBundle,
  replayFixture,
  verifyBinding,
  verifyBundle,
  writeBundle,
} from '../src/bundle.js';
import { firstDifference, tupleDiff } from '@awayleg/rules';

const COURSE_BYTES = Buffer.from('[1,6,6,0,[],[1,2,3,4,5]]', 'utf8');
const CONTRACT = '0x0000000000000000000000000000000000000001';
const HOME = '0x00000000000000000000000000000000e111e111';
const AWAY = '0x00000000000000000000000000000000e222e222';
const HC = '0x00000000000000000000000000000000ca11ca11';
const AC = '0x00000000000000000000000000000000ca22ca22';
const REG = '0x00000000000000000000000000000000000000aa';

function makeBundle(dir, overrides = {}) {
  const replay = replayFixture({
    chainId: 31337,
    contract: CONTRACT,
    fixtureId: '7',
    courseBytes: COURSE_BYTES,
    homeOrder: [0, 1, 2, 3, 4],
    awayOrder: [4, 3, 2, 1, 0],
  });
  const manifest = manifestFor({
    chainId: 31337,
    contract: CONTRACT,
    fixtureId: '7',
    sourceBlock: { number: 42, hash: '0x' + 'ab'.repeat(32) },
    courseHash: replay.courseHash,
    entrants: { home: HOME, away: AWAY },
    captains: { home: HC, away: AC },
    lockedStrategies: { home: [0, 1, 2, 3, 4], away: [4, 3, 2, 1, 0] },
    registry: REG,
    txRefs: [{ kind: 'StrategyLocked', txHash: '0x' + '11'.repeat(32), logIndex: 0, blockNumber: 42 }],
    replay,
    ...overrides,
  });
  writeBundle(dir, manifest, COURSE_BYTES, replay.replayBytes);
  return { manifest, replay };
}

describe('T-013 bundle verification (offline)', () => {
  it('verifies a valid bundle and recomputes the tuple', () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    makeBundle(dir);
    const v = verifyBundle(dir);
    assert.equal(v.ok, true);
    assert.equal(v.outcome, 'HOME_WIN');
    assert.equal(v.tuple.homeDelivered, 5);
    assert.equal(v.tuple.awayTurns, 9);
    assert.equal(
      v.replayHash,
      '0x5bc5556fe729bd9809d6e2b772870009b11441e5c7a50bc5295d4640ce53e5ac',
    );
  });

  it('rejects swapped contract / fixture / course precisely', () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    makeBundle(dir);
    // contract swapped
    const { manifest, replayBytes } = readBundle(dir);
    const swapped = { ...manifest, contract: '0x' + '22'.repeat(20) };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(swapped));
    assert.throws(() => verifyBundle(dir), /replay bytes differ|digest/);

    // fixture swapped
    makeBundle(dir);
    const m2 = { ...readBundle(dir).manifest, fixtureId: '8' };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m2));
    assert.throws(() => verifyBundle(dir), BundleError);

    // course swapped
    makeBundle(dir);
    writeFileSync(join(dir, 'course.json'), '[1,6,6,0,[],[9,2,3,4,5]]');
    assert.throws(() => verifyBundle(dir), /course digest mismatch/);
  });

  it('rejects unsupported schema and oversized members', () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    makeBundle(dir);
    const m = { ...readBundle(dir).manifest, schemaVersion: 99 };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
    assert.throws(() => verifyBundle(dir), /unsupported bundle schema/);
    // oversized member rejected before parse
    makeBundle(dir);
    writeFileSync(join(dir, 'course.json'), Buffer.alloc(600 * 1024));
    assert.throws(() => verifyBundle(dir), /exceeds size cap/);
  });

  it('online binding rejects a mismatching canonical block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    makeBundle(dir);
    const reader = {
      getBlock: async (n) => ({ number: n, hash: '0x' + 'cd'.repeat(32) }),
      getLogs: async () => [],
    };
    await assert.rejects(() => verifyBinding(dir, reader), /canonical block mismatch/);
  });

  it('online binding accepts matching block + locked orders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    const { manifest } = makeBundle(dir);
    const reader = {
      getBlock: async (n) => ({ number: n, hash: manifest.sourceBlock.hash }),
      getLogs: async () => [
        await fakeLocked(manifest.contract, manifest.fixtureId, 0, [0, 1, 2, 3, 4]),
        await fakeLocked(manifest.contract, manifest.fixtureId, 1, [4, 3, 2, 1, 0]),
      ],
    };
    const r = await verifyBinding(dir, reader);
    assert.equal(r.ok, true);
    assert.equal(r.boundBlock, 42);
  });
});

import { fakeLog } from '../../../services/indexer/src/source.js';
async function fakeLocked(contract, fixtureId, slot, order) {
  const raw = fakeLog(contract, 'StrategyLocked', {
    id: BigInt(fixtureId),
    slot,
    entrant: slot === 0 ? HOME : AWAY,
    order,
  });
  return { data: raw.data, topics: raw.topics };
}

describe('T-012 disagreement diagnosis', () => {
  it('finds the first differing frame between two traces', () => {
    const a = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const b = [[0, 0, 0], [1, 1, 1], [2, 9, 2]];
    const d = firstDifference(a, b);
    assert.equal(d.kind, 'DIFFER');
    assert.equal(d.turn, 2);
  });

  it('reports missing trace without inventing a turn', () => {
    const d = firstDifference([[0, 0, 0]], null);
    assert.equal(d.kind, 'MISSING');
    assert.equal(d.side, 'b');
  });

  it('equal digest but unequal scores: names the differing fields', () => {
    const t1 = { replayHash: '0xaa', homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 };
    const t2 = { ...t1, awayTurns: 10 };
    assert.deepEqual(tupleDiff(t1, t2), ['awayTurns']);
  });

  it('length divergence surfaces the first missing frame', () => {
    const a = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const b = [[0, 0, 0], [1, 1, 1]];
    const d = firstDifference(a, b);
    assert.equal(d.kind, 'LENGTH');
    assert.equal(d.turn, 2);
  });
});

describe('T-011 separate club runner (CLI outside repo cwd)', () => {
  it('runs `awayleg replay verify` from an unrelated directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'awayleg-bun-'));
    makeBundle(dir);
    const otherCwd = mkdtempSync(join(tmpdir(), 'awayleg-cwd-'));
    const bin = resolve(process.cwd(), 'bin/awayleg.js');
    const out = execFileSync(process.execPath, [bin, 'replay', 'verify', '--bundle', dir], {
      cwd: otherCwd,
      encoding: 'utf8',
    });
    assert.match(out, /OFFLINE VERIFY OK/);
    assert.match(out, /HOME_WIN/);
  });

  it('diff command reports the first differing turn', () => {
    const dirA = mkdtempSync(join(tmpdir(), 'awayleg-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'awayleg-b-'));
    makeBundle(dirA);
    const { replay } = makeBundle(dirB);
    // tamper: rewrite replay with a different away frame
    const arr = JSON.parse(replay.replayBytes.toString('utf8'));
    arr[8][5] = [5, 5, 0];
    writeFileSync(join(dirB, 'replay.json'), JSON.stringify(arr));
    const bin = resolve(process.cwd(), 'bin/awayleg.js');
    const out = execFileSync(process.execPath, [bin, 'diff', '--a', dirA, '--b', dirB], {
      encoding: 'utf8',
    });
    assert.match(out, /away: first differing frame at turn 5/);
  });
});
