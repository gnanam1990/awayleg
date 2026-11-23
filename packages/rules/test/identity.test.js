// T-003 Version identity: changing fixture, deployment, course or strategy
// while keeping others fixed must change the serialized identity. Unknown
// rules versions are rejected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalError,
  replayArray,
  replayHash,
} from '../src/index.js';

const base = {
  chainId: 31337,
  contract: '0x0000000000000000000000000000000000000001',
  fixtureId: '7',
  courseHash: '0x3de7c3c6dfc61070fbaa0fc30ef3bbd01741ccb7a31492fa72bcf9ad9cbb5c95',
  homeOrder: [0, 1, 2, 3, 4],
  awayOrder: [4, 3, 2, 1, 0],
  homeFrames: [[0, 0, 0], [1, 1, 1]],
  awayFrames: [[0, 0, 0], [1, 6, 0]],
};

describe('T-003 version identity', () => {
  const baseHash = replayHash(base);
  const baseBytes = JSON.stringify(replayArray(base));

  it('fixture id changes identity', () => {
    const other = replayHash({ ...base, fixtureId: '8' });
    assert.notEqual(other, baseHash);
  });

  it('deployment (chain + contract) changes identity', () => {
    assert.notEqual(replayHash({ ...base, chainId: 56 }), baseHash);
    assert.notEqual(
      replayHash({ ...base, contract: '0x0000000000000000000000000000000000000002' }),
      baseHash,
    );
  });

  it('course hash changes identity', () => {
    const otherCourse =
      '0x' + '00'.repeat(31) + '01';
    assert.notEqual(replayHash({ ...base, courseHash: otherCourse }), baseHash);
  });

  it('strategy order changes identity', () => {
    assert.notEqual(replayHash({ ...base, homeOrder: [4, 3, 2, 1, 0] }), baseHash);
    assert.notEqual(replayHash({ ...base, awayOrder: [0, 1, 2, 3, 4] }), baseHash);
  });

  it('frames change identity', () => {
    const alt = { ...base, homeFrames: [[0, 0, 0], [1, 2, 1]] };
    assert.notEqual(replayHash(alt), baseHash);
  });

  it('rejects unknown rules versions', () => {
    assert.throws(() => replayArray({ ...base, version: 2 }), CanonicalError);
    assert.throws(() => replayArray({ ...base, version: 0 }), CanonicalError);
  });

  it('rejects malformed identity members', () => {
    assert.throws(() => replayArray({ ...base, contract: '0xABCDEF0000000000000000000000000000000001' }));
    assert.throws(() => replayArray({ ...base, contract: '0000000000000000000000000000000000000001' }));
    assert.throws(() => replayArray({ ...base, fixtureId: '007' }));
    assert.throws(() => replayArray({ ...base, fixtureId: 'abc' }));
    assert.throws(() => replayArray({ ...base, fixtureId: 7 }));
    assert.throws(() => replayArray({ ...base, chainId: 0 }));
    assert.throws(() => replayArray({ ...base, courseHash: '0xZZ' }));
    assert.throws(() => replayArray({ ...base, homeFrames: [] }));
    assert.throws(() => replayArray({ ...base, homeFrames: [[1, 0, 0]] }));
    assert.throws(() => replayArray({ ...base, homeFrames: [[0, 36, 0]] }));
    assert.throws(() => replayArray({ ...base, homeFrames: [[0, 0, 0], [1, 1, 6]] }));
  });

  it('serialization is byte-stable across calls (INV-01)', () => {
    assert.equal(JSON.stringify(replayArray(base)), baseBytes);
    assert.equal(replayHash(base), baseHash);
  });
});
