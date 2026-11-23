// Deterministic runner for v1 courier races.
// One entrant walks the course from `start`, visiting parcels in the order
// given by their public permutation of parcel IDs [0..4].
// Each turn a fresh FIFO BFS computes the first shortest path to the current
// target and the runner moves exactly one cell along it. A parcel is
// delivered only when it is the current target upon arrival.
// Stop after the fifth delivery or MAX_MOVES moves.
// Frame = [turn, cell, deliveredCount]; turn 0 is the initial frame.

import { CanonicalError } from './canonical.js';
import { MAX_MOVES, PARCEL_COUNT, shortestPath } from './course.js';

export function isPermutation(order) {
  if (!Array.isArray(order) || order.length !== PARCEL_COUNT) return false;
  const seen = new Set(order);
  return (
    seen.size === PARCEL_COUNT &&
    order.every((v) => Number.isInteger(v) && v >= 0 && v < PARCEL_COUNT)
  );
}

export function assertPermutation(order, label = 'order') {
  if (!isPermutation(order)) {
    throw new CanonicalError(`${label}: must be a permutation of [0,1,2,3,4]`);
  }
  return order;
}

// Runs a single strategy against a parsed course.
// Returns { frames, deliveries, turns } where turns is the final frame's turn.
export function runStrategy(course, order) {
  assertPermutation(order);
  const frames = [[0, course.start, 0]];
  let cell = course.start;
  let delivered = 0;
  let turn = 0;
  for (const parcelId of order) {
    const target = course.parcels[parcelId];
    while (cell !== target && turn < MAX_MOVES) {
      const path = shortestPath(cell, target, course.blocked, course.width, course.height);
      if (path === null) {
        // Unreachable target: unreachable courses are rejected at validation,
        // so this can only occur for programmatically constructed input.
        throw new CanonicalError(`engine: parcel ${parcelId} unreachable mid-run`);
      }
      cell = path[1]; // move exactly one cell toward the target
      turn += 1;
      if (cell === target) delivered += 1;
      frames.push([turn, cell, delivered]);
    }
    if (turn >= MAX_MOVES) break;
  }
  return { frames, deliveries: delivered, turns: turn };
}

// Higher delivered count wins; on equal deliveries fewer moves wins;
// equal totals draw. Returns 'HOME_WIN' | 'AWAY_WIN' | 'DRAW'.
export function outcome(home, away) {
  if (home.deliveries !== away.deliveries) {
    return home.deliveries > away.deliveries ? 'HOME_WIN' : 'AWAY_WIN';
  }
  if (home.turns !== away.turns) {
    return home.turns < away.turns ? 'HOME_WIN' : 'AWAY_WIN';
  }
  return 'DRAW';
}

// Season points: win 3, draw 1 each, loss 0.
export function points(result) {
  switch (result) {
    case 'HOME_WIN':
      return { home: 3, away: 0 };
    case 'AWAY_WIN':
      return { home: 0, away: 3 };
    default:
      return { home: 1, away: 1 };
  }
}
