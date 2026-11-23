// Course format v1: [1, 6, 6, start, blocked[], parcels[]]
// Grid is width*height = 6*6, cell = y*width + x, range 0..35.
// blocked: unique ascending cells. parcels: exactly five unique cells whose
// position in the list is the parcel ID (0..4). start, walls and parcels are
// disjoint. Every parcel must be reachable from start through open cells.

import { CanonicalError, decodeCanonical, encodeCanonical, isSafeInt } from './canonical.js';

export const RULES_VERSION = 1;
export const GRID_W = 6;
export const GRID_H = 6;
export const CELL_COUNT = GRID_W * GRID_H;
export const PARCEL_COUNT = 5;
export const MAX_MOVES = 30;

export function cellX(cell, w = GRID_W) {
  return cell % w;
}
export function cellY(cell, w = GRID_W) {
  return Math.floor(cell / w);
}
export function toCell(x, y, w = GRID_W) {
  return y * w + x;
}

// FIFO BFS neighbor order: down(+y), right(+x), up(-y), left(-x),
// applied after boundary/wall checks.
export function neighbors(cell, blocked, w = GRID_W, h = GRID_H) {
  const x = cellX(cell, w);
  const y = cellY(cell, w);
  const out = [];
  if (y + 1 < h) out.push(cell + w); // down
  if (x + 1 < w) out.push(cell + 1); // right
  if (y - 1 >= 0) out.push(cell - w); // up
  if (x - 1 >= 0) out.push(cell - 1); // left
  return blocked.size === 0 ? out : out.filter((c) => !blocked.has(c));
}

// First shortest path discovered by FIFO BFS with visited-on-enqueue.
// Returns the ordered list of cells from `from` to `to` inclusive,
// or null when unreachable.
export function shortestPath(from, to, blocked, w = GRID_W, h = GRID_H) {
  if (from === to) return [from];
  const visited = new Set([from]);
  const parent = new Map();
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const n of neighbors(cur, blocked, w, h)) {
      if (visited.has(n)) continue;
      visited.add(n);
      parent.set(n, cur);
      if (n === to) {
        const path = [to];
        let p = to;
        while (p !== from) {
          p = parent.get(p);
          path.unshift(p);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

export function parseCourse(value) {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new CanonicalError('course: must be [1,6,6,start,blocked,parcels]');
  }
  const [version, w, h, start, blocked, parcels] = value;
  if (version !== RULES_VERSION) {
    throw new CanonicalError(`course: unsupported rules version ${version}`);
  }
  if (w !== GRID_W || h !== GRID_H) {
    throw new CanonicalError(`course: grid must be ${GRID_W}x${GRID_H}`);
  }
  if (!isSafeInt(start) || start >= CELL_COUNT) {
    throw new CanonicalError(`course: start out of range (${start})`);
  }
  if (!Array.isArray(blocked)) {
    throw new CanonicalError('course: blocked must be an array');
  }
  const blockedSet = new Set();
  let prev = -1;
  for (const cell of blocked) {
    if (!isSafeInt(cell) || cell >= CELL_COUNT) {
      throw new CanonicalError(`course: blocked cell out of range (${cell})`);
    }
    if (cell <= prev) {
      throw new CanonicalError('course: blocked cells must be unique ascending');
    }
    prev = cell;
    blockedSet.add(cell);
  }
  if (!Array.isArray(parcels) || parcels.length !== PARCEL_COUNT) {
    throw new CanonicalError(`course: parcels must be ${PARCEL_COUNT} cells`);
  }
  const parcelSet = new Set();
  for (const cell of parcels) {
    if (!isSafeInt(cell) || cell >= CELL_COUNT) {
      throw new CanonicalError(`course: parcel cell out of range (${cell})`);
    }
    if (parcelSet.has(cell)) {
      throw new CanonicalError('course: duplicated parcel cell');
    }
    parcelSet.add(cell);
  }
  if (blockedSet.has(start)) {
    throw new CanonicalError('course: start lies on a wall');
  }
  if (parcelSet.has(start)) {
    throw new CanonicalError('course: start lies on a parcel');
  }
  for (const cell of parcels) {
    if (blockedSet.has(cell)) {
      throw new CanonicalError('course: parcel lies on a wall');
    }
  }
  // Reachability of every parcel from start through open cells.
  for (let id = 0; id < parcels.length; id++) {
    if (shortestPath(start, parcels[id], blockedSet, w, h) === null) {
      throw new CanonicalError(`course: parcel ${id} at cell ${parcels[id]} unreachable`);
    }
  }
  return {
    version,
    width: w,
    height: h,
    start,
    blocked: blockedSet,
    blockedList: blocked.slice(),
    parcels: parcels.slice(),
  };
}

export function courseFromBytes(bytes, maxBytes = 64 * 1024) {
  return parseCourse(decodeCanonical(bytes, 'course', maxBytes));
}

export function courseBytes(course) {
  const parsed = course.parcels ? course : parseCourse(course);
  const raw = [
    parsed.version ?? RULES_VERSION,
    parsed.width ?? GRID_W,
    parsed.height ?? GRID_H,
    parsed.start,
    parsed.blockedList ?? [...parsed.blocked].sort((a, b) => a - b),
    parsed.parcels,
  ];
  return encodeCanonical(raw, 'course');
}
