// Replay identity v1.
// Canonical replay bytes = JSON.stringify of
// [1, chainId, lowercaseContract, decimalFixtureIdString, lowercaseCourseHash,
//  homeOrder, awayOrder, homeFrames, awayFrames]
// SHA-256 over those bytes is the replayHash. The attestation tuple is
// (replayHash, homeDelivered, homeTurns, awayDelivered, awayTurns);
// equality is exact across all five fields.

import { CanonicalError, isSafeInt } from './canonical.js';
import { sha256Hex } from './sha256.js';
import { assertPermutation } from './engine.js';
import { CELL_COUNT, PARCEL_COUNT, RULES_VERSION } from './course.js';

const HEX_ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX_32 = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

export function assertAddress(value, label = 'address') {
  if (typeof value !== 'string' || !HEX_ADDRESS.test(value)) {
    throw new CanonicalError(`${label}: expected lowercase 0x 20-byte hex`);
  }
  return value;
}

export function assertHash32(value, label = 'hash') {
  if (typeof value !== 'string' || !HEX_32.test(value)) {
    throw new CanonicalError(`${label}: expected lowercase 0x 32-byte hex`);
  }
  return value;
}

export function assertFixtureId(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new CanonicalError('fixtureId: expected minimal decimal digits');
  }
  return value;
}

export function assertFrames(frames, label = 'frames') {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new CanonicalError(`${label}: nonempty array required`);
  }
  let prevDelivered = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!Array.isArray(f) || f.length !== 3 || !f.every(isSafeInt)) {
      throw new CanonicalError(`${label}[${i}]: frame must be [turn,cell,delivered]`);
    }
    const [turn, cell, delivered] = f;
    if (turn !== i) {
      throw new CanonicalError(`${label}[${i}]: turns must increment by 1 from 0`);
    }
    if (cell >= CELL_COUNT) {
      throw new CanonicalError(`${label}[${i}]: cell out of range`);
    }
    if (delivered > PARCEL_COUNT || delivered < prevDelivered) {
      throw new CanonicalError(`${label}[${i}]: delivered count invalid`);
    }
    prevDelivered = delivered;
  }
  return frames;
}

export function assertChainId(value) {
  if (!isSafeInt(value) || value === 0) {
    throw new CanonicalError('chainId: expected positive integer');
  }
  return value;
}

// Builds the canonical replay array and validates every member.
export function replayArray({
  chainId,
  contract,
  fixtureId,
  courseHash,
  homeOrder,
  awayOrder,
  homeFrames,
  awayFrames,
  version = RULES_VERSION,
}) {
  if (version !== RULES_VERSION) {
    throw new CanonicalError(`replay: unsupported rules version ${version}`);
  }
  return [
    version,
    assertChainId(chainId),
    assertAddress(contract, 'contract'),
    assertFixtureId(fixtureId),
    assertHash32(courseHash, 'courseHash'),
    assertPermutation(homeOrder, 'homeOrder'),
    assertPermutation(awayOrder, 'awayOrder'),
    assertFrames(homeFrames, 'homeFrames'),
    assertFrames(awayFrames, 'awayFrames'),
  ];
}

export function replayBytes(identity) {
  return Buffer.from(JSON.stringify(replayArray(identity)), 'utf8');
}

export function replayHash(identity) {
  return sha256Hex(replayBytes(identity));
}

// The attestation tuple both captains must reproduce exactly.
export function attestationTuple(identity) {
  const arr = replayArray(identity);
  const hash = sha256Hex(Buffer.from(JSON.stringify(arr), 'utf8'));
  const homeFrames = arr[7];
  const awayFrames = arr[8];
  return {
    replayHash: hash,
    homeDelivered: homeFrames[homeFrames.length - 1][2],
    homeTurns: homeFrames[homeFrames.length - 1][0],
    awayDelivered: awayFrames[awayFrames.length - 1][2],
    awayTurns: awayFrames[awayFrames.length - 1][0],
  };
}

export function tuplesEqual(a, b) {
  return (
    a.replayHash === b.replayHash &&
    a.homeDelivered === b.homeDelivered &&
    a.homeTurns === b.homeTurns &&
    a.awayDelivered === b.awayDelivered &&
    a.awayTurns === b.awayTurns
  );
}

// First differing frame between two traces.
// Returns { kind: 'DIFFER', turn, a, b } | { kind: 'LENGTH', turn, a, b }
// | { kind: 'EQUAL' } | { kind: 'MISSING', side }.
// A missing trace cannot manufacture a divergence turn.
export function firstDifference(framesA, framesB) {
  if (framesA == null && framesB == null) return { kind: 'MISSING', side: 'both' };
  if (framesA == null) return { kind: 'MISSING', side: 'a' };
  if (framesB == null) return { kind: 'MISSING', side: 'b' };
  const n = Math.min(framesA.length, framesB.length);
  for (let i = 0; i < n; i++) {
    const a = framesA[i];
    const b = framesB[i];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3) {
      return { kind: 'DIFFER', turn: i, a, b };
    }
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) {
      return { kind: 'DIFFER', turn: i, a, b };
    }
  }
  if (framesA.length !== framesB.length) {
    return {
      kind: 'LENGTH',
      turn: n,
      a: framesA.length > n ? framesA[n] : null,
      b: framesB.length > n ? framesB[n] : null,
    };
  }
  return { kind: 'EQUAL' };
}

// For equal digests but unequal score tuples, identify the differing fields.
export function tupleDiff(a, b) {
  const fields = ['replayHash', 'homeDelivered', 'homeTurns', 'awayDelivered', 'awayTurns'];
  return fields.filter((f) => a[f] !== b[f]);
}
