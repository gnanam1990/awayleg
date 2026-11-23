// T-002 Input and path boundaries.
// Reject duplicated parcels, unreachable cells, unsafe numbers and
// noncanonical bytes. On a symmetric empty board from cell 0 to cell 7 the
// first step is cell 6 (down precedes right). Verify each move is adjacent
// and wall-free, early completion and the 30-turn stop.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalError,
  courseFromBytes,
  decodeCanonical,
  isPermutation,
  neighbors,
  parseCourse,
  runStrategy,
  shortestPath,
} from '../src/index.js';

function course(start, blocked = [], parcels = [1, 2, 3, 4, 5]) {
  return parseCourse([1, 6, 6, start, blocked, parcels]);
}

describe('T-002 input validation', () => {
  it('rejects duplicated parcels', () => {
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, 4]]), CanonicalError);
  });

  it('rejects unreachable parcels', () => {
    // Wall ring around parcel at cell 7: neighbors 1,6,8,13 all blocked.
    assert.throws(
      () => parseCourse([1, 6, 6, 0, [1, 6, 8, 13], [7, 2, 3, 4, 5]]),
      /unreachable/,
    );
  });

  it('rejects unsafe numbers and negative values', () => {
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, Number.MAX_SAFE_INTEGER + 1]]));
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, -1]]));
    assert.throws(() => parseCourse([1, 6, 6, -0, [], [1, 2, 3, 4, 5]]));
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, 1.5]]));
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, '5']]));
  });

  it('rejects noncanonical bytes', () => {
    // whitespace
    assert.throws(() => courseFromBytes(Buffer.from('[1, 6, 6, 0, [], [1,2,3,4,5]]')));
    // BOM
    assert.throws(() => courseFromBytes(Buffer.from('﻿[1,6,6,0,[],[1,2,3,4,5]]')));
    // trailing LF
    assert.throws(() => courseFromBytes(Buffer.from('[1,6,6,0,[],[1,2,3,4,5]]\n')));
    // float literal
    assert.throws(() => courseFromBytes(Buffer.from('[1,6,6,0.0,[],[1,2,3,4,5]]')));
    // object member
    assert.throws(() => decodeCanonical(Buffer.from('{"a":1}')));
    // out-of-range cell
    assert.throws(() => parseCourse([1, 6, 6, 0, [], [1, 2, 3, 4, 36]]));
    // non-ascending walls
    assert.throws(() => parseCourse([1, 6, 6, 0, [10, 9], [1, 2, 3, 4, 5]]));
    // wrong grid
    assert.throws(() => parseCourse([1, 7, 7, 0, [], [1, 2, 3, 4, 5]]));
    // wrong version
    assert.throws(() => parseCourse([2, 6, 6, 0, [], [1, 2, 3, 4, 5]]));
  });

  it('rejects bad permutations', () => {
    assert.equal(isPermutation([0, 1, 2, 3, 4]), true);
    assert.equal(isPermutation([0, 1, 2, 3]), false);
    assert.equal(isPermutation([0, 1, 2, 3, 5]), false);
    assert.equal(isPermutation([0, 1, 2, 3, 3]), false);
    assert.throws(() => runStrategy(course(0), [0, 0, 1, 2, 3]), CanonicalError);
  });
});

describe('T-002 path semantics', () => {
  it('down precedes right: 0 -> 7 first step is cell 6', () => {
    const path = shortestPath(0, 7, new Set());
    assert.equal(path[1], 6);
    assert.deepEqual(path, [0, 6, 7]);
  });

  it('every move is adjacent and wall-free', () => {
    const blocked = [8, 13, 14];
    const c = course(0, blocked, [7, 21, 27, 33, 35]);
    const { frames } = runStrategy(c, [0, 1, 2, 3, 4]);
    const walls = new Set(blocked);
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1][1];
      const cur = frames[i][1];
      const step = neighbors(prev, walls);
      assert.ok(step.includes(cur), `turn ${i}: ${prev} -> ${cur} not adjacent/open`);
      assert.ok(!walls.has(cur));
    }
  });

  it('runs to early completion in fewer than 30 moves', () => {
    const c = course(0, [], [1, 2, 3, 4, 5]);
    const { frames, deliveries, turns } = runStrategy(c, [0, 1, 2, 3, 4]);
    assert.equal(deliveries, 5);
    assert.equal(turns, 5);
    assert.equal(frames.length, 6); // includes initial frame
  });

  it('stops at 30 moves when the final parcel stays undelivered', () => {
    // Farthest cell ordering: force maximum walking. Parcels spread so each leg
    // is long; a diagonal zigzag across an open 6x6 board can exceed 30.
    // Start 0, order visits cells 35,0-ish alternately: parcels must be valid.
    const c = course(0, [], [35, 1, 34, 2, 33]);
    const { frames, deliveries, turns } = runStrategy(c, [0, 1, 2, 3, 4]);
    assert.ok(turns <= 30);
    assert.ok(deliveries < 5);
    assert.equal(frames.length, turns + 1);
    // Last frame records the capped turn.
    assert.equal(frames[frames.length - 1][0], turns);
  });

  it('neighbor order is down, right, up, left', () => {
    assert.deepEqual(neighbors(7, new Set()), [13, 8, 1, 6]);
    assert.deepEqual(neighbors(0, new Set()), [6, 1]); // top-left corner
    assert.deepEqual(neighbors(35, new Set()), [29, 34]); // bottom-right corner
    assert.deepEqual(neighbors(7, new Set([13])), [8, 1, 6]); // down blocked
  });
});
