// T-001 Straight corridor: run the published vector with two distinct
// policies; compare each frame, both turn totals and SHA-256 against the
// provided reference bytes.

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attestationTuple,
  courseBytes,
  decodeCanonical,
  outcome,
  parseCourse,
  replayArray,
  replayHash,
  runStrategy,
  sha256Hex,
} from '../src/index.js';

const vector = JSON.parse(
  readFileSync(new URL('../../../fixtures/corridor.json', import.meta.url), 'utf8'),
);

describe('T-001 straight corridor vector', () => {
  const course = parseCourse(vector.course);

  it('reproduces the canonical course hash', () => {
    const bytes = courseBytes(vector.course);
    assert.equal(bytes.toString('utf8'), '[1,6,6,0,[],[1,2,3,4,5]]');
    assert.equal(sha256Hex(bytes), vector.courseSha256);
  });

  it('runs home order [0,1,2,3,4]: 5 deliveries in 5 turns', () => {
    const run = runStrategy(course, [0, 1, 2, 3, 4]);
    assert.deepEqual(run.frames, vector.replay[7]);
    assert.equal(run.deliveries, 5);
    assert.equal(run.turns, 5);
  });

  it('runs away order [4,3,2,1,0]: 5 deliveries in 9 turns', () => {
    const run = runStrategy(course, [4, 3, 2, 1, 0]);
    assert.deepEqual(run.frames, vector.replay[8]);
    assert.equal(run.deliveries, 5);
    assert.equal(run.turns, 9);
  });

  it('reproduces canonical replay bytes and replay hash', () => {
    const arr = replayArray({
      chainId: vector.replay[1],
      contract: vector.replay[2],
      fixtureId: vector.replay[3],
      courseHash: vector.replay[4],
      homeOrder: vector.replay[5],
      awayOrder: vector.replay[6],
      homeFrames: vector.replay[7],
      awayFrames: vector.replay[8],
    });
    assert.deepEqual(arr, vector.replay);
    const bytes = Buffer.from(JSON.stringify(arr), 'utf8');
    assert.equal(sha256Hex(bytes), vector.replaySha256);
    assert.equal(
      replayHash({
        chainId: vector.replay[1],
        contract: vector.replay[2],
        fixtureId: vector.replay[3],
        courseHash: vector.replay[4],
        homeOrder: vector.replay[5],
        awayOrder: vector.replay[6],
        homeFrames: vector.replay[7],
        awayFrames: vector.replay[8],
      }),
      vector.replaySha256,
    );
  });

  it('produces the reference attestation tuple and HOME_WIN', () => {
    const tuple = attestationTuple({
      chainId: vector.replay[1],
      contract: vector.replay[2],
      fixtureId: vector.replay[3],
      courseHash: vector.replay[4],
      homeOrder: vector.replay[5],
      awayOrder: vector.replay[6],
      homeFrames: vector.replay[7],
      awayFrames: vector.replay[8],
    });
    assert.deepEqual(
      [tuple.replayHash, tuple.homeDelivered, tuple.homeTurns, tuple.awayDelivered, tuple.awayTurns],
      vector.attestationTuple,
    );
    const home = runStrategy(course, [0, 1, 2, 3, 4]);
    const away = runStrategy(course, [4, 3, 2, 1, 0]);
    assert.equal(outcome(home, away), vector.result);
  });

  it('decodes reference course bytes from a packed string', () => {
    const packed = decodeCanonical(Buffer.from('[1,6,6,0,[],[1,2,3,4,5]]', 'utf8'), 'course');
    assert.deepEqual(packed, vector.course);
  });
});
