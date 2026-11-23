// Versioned evidence bundle: manifest.json + course.json + replay.json.
// Guards: no paths outside the bundle, size caps, supported schema only.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import {
  assertAddress,
  assertFixtureId,
  assertFrames,
  assertHash32,
  assertPermutation,
  attestationTuple,
  courseFromBytes,
  outcome,
  replayArray,
  replayHash,
  runStrategy,
  sha256Hex,
  parseCourse,
  RULES_VERSION,
} from '@awayleg/rules';
import { decodeLog } from '@awayleg/chain';

export const BUNDLE_SCHEMA = 1;
export const RULES_PACKAGE_VERSION = '1.0.0';
const MAX_MANIFEST = 256 * 1024;
const MAX_MEMBER = 512 * 1024;

export class BundleError extends Error {
  constructor(m) {
    super(m);
    this.name = 'BundleError';
  }
}

function safePath(dir, name) {
  const p = resolve(dir, normalize(name));
  const root = resolve(dir) + sep;
  if (p !== resolve(dir) && !p.startsWith(root)) {
    throw new BundleError(`path escapes bundle: ${name}`);
  }
  return p;
}

function readMember(dir, name) {
  const p = safePath(dir, name);
  const st = statSync(p);
  if (st.size > MAX_MEMBER) throw new BundleError(`${name} exceeds size cap`);
  return readFileSync(p);
}

// sha256 over this package's own sources — the bundle records exactly which
// rules implementation produced it (INV-01 reproducibility check).
export function rulesChecksum() {
  const files = ['canonical.js', 'course.js', 'engine.js', 'replay.js', 'index.js'];
  const h = createHash('sha256');
  const base = new URL('../../rules/src/', import.meta.url);
  for (const f of files) {
    h.update(readFileSync(new URL(f, base)));
  }
  return `0x${h.digest('hex')}`;
}

export function buildReplay({
  chainId,
  contract,
  fixtureId,
  courseHash,
  homeOrder,
  awayOrder,
  homeFrames,
  awayFrames,
}) {
  const bytes = Buffer.from(
    JSON.stringify(
      replayArray({
        chainId,
        contract,
        fixtureId,
        courseHash,
        homeOrder,
        awayOrder,
        homeFrames,
        awayFrames,
      }),
    ),
    'utf8',
  );
  return { bytes, hash: sha256Hex(bytes) };
}

// Run a fixture's two locked strategies against course bytes.
export function replayFixture({ chainId, contract, fixtureId, courseBytes, homeOrder, awayOrder }) {
  const course = courseFromBytes(courseBytes);
  const courseHash = sha256Hex(courseBytes);
  const home = runStrategy(course, homeOrder);
  const away = runStrategy(course, awayOrder);
  const { bytes, hash } = buildReplay({
    chainId,
    contract: contract.toLowerCase(),
    fixtureId: String(fixtureId),
    courseHash,
    homeOrder,
    awayOrder,
    homeFrames: home.frames,
    awayFrames: away.frames,
  });
  const tuple = attestationTuple({
    chainId,
    contract: contract.toLowerCase(),
    fixtureId: String(fixtureId),
    courseHash,
    homeOrder,
    awayOrder,
    homeFrames: home.frames,
    awayFrames: away.frames,
  });
  return {
    replayBytes: bytes,
    replayHash: hash,
    courseHash,
    home,
    away,
    outcome: outcome(home, away),
    tuple,
  };
}

export function writeBundle(dir, manifest, courseBytes, replayBytes) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(safePath(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(safePath(dir, 'course.json'), courseBytes);
  writeFileSync(safePath(dir, 'replay.json'), replayBytes);
  return dir;
}

export function manifestFor({
  chainId,
  contract,
  fixtureId,
  sourceBlock,
  courseHash,
  entrants,
  captains,
  lockedStrategies,
  registry,
  txRefs,
  replay,
}) {
  return {
    schemaVersion: BUNDLE_SCHEMA,
    chainId,
    contract: contract.toLowerCase(),
    fixtureId: String(fixtureId),
    sourceBlock,
    rulesPackage: { name: '@awayleg/rules', version: RULES_PACKAGE_VERSION, checksum: rulesChecksum() },
    rulesVersion: RULES_VERSION,
    courseHash,
    entrants,
    captains,
    lockedStrategies,
    registry: registry.toLowerCase(),
    txRefs,
    replayHash: replay.replayHash,
    scores: {
      home: { delivered: replay.home.deliveries, turns: replay.home.turns },
      away: { delivered: replay.away.deliveries, turns: replay.away.turns },
    },
    outcome: replay.outcome,
  };
}

export function readBundle(dir) {
  const manifestBytes = readMember(dir, 'manifest.json');
  if (manifestBytes.length > MAX_MANIFEST) throw new BundleError('manifest too large');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new BundleError('manifest is not JSON');
  }
  if (manifest.schemaVersion !== BUNDLE_SCHEMA) {
    throw new BundleError(`unsupported bundle schema ${manifest.schemaVersion}`);
  }
  const courseBytes = readMember(dir, 'course.json');
  const replayBytes = readMember(dir, 'replay.json');
  return { manifest, courseBytes, replayBytes };
}

// Offline recompute: exact inputs -> identical canonical bytes + tuple.
export function verifyBundle(dir) {
  const { manifest, courseBytes, replayBytes } = readBundle(dir);
  const course = courseFromBytes(courseBytes);
  const actualCourseHash = sha256Hex(courseBytes);
  if (actualCourseHash !== manifest.courseHash.toLowerCase()) {
    throw new BundleError(
      `course digest mismatch: file ${actualCourseHash}, manifest ${manifest.courseHash}`,
    );
  }
  const replay = replayFixture({
    chainId: manifest.chainId,
    contract: manifest.contract,
    fixtureId: manifest.fixtureId,
    courseBytes,
    homeOrder: manifest.lockedStrategies.home,
    awayOrder: manifest.lockedStrategies.away,
  });
  const given = replayBytes.toString('utf8');
  const recomputed = replay.replayBytes.toString('utf8');
  if (given !== recomputed) {
    throw new BundleError('replay bytes differ from recompute');
  }
  if (replay.replayHash !== manifest.replayHash.toLowerCase()) {
    throw new BundleError('replay hash differs from manifest');
  }
  const parsed = JSON.parse(given);
  return {
    ok: true,
    replayHash: replay.replayHash,
    outcome: replay.outcome,
    tuple: replay.tuple,
    homeFrames: parsed[7],
    awayFrames: parsed[8],
    scores: replay,
    manifest,
  };
}

// Online binding check: the manifest's source block must exist canonically on
// the expected chain, and the fixture's locked strategies must match the
// bundle's recorded orders.
export async function verifyBinding(dir, reader, contractAddress) {
  const { manifest } = readBundle(dir);
  if (contractAddress && manifest.contract !== contractAddress.toLowerCase()) {
    throw new BundleError(
      `contract mismatch: bundle ${manifest.contract} vs ${contractAddress}`,
    );
  }
  const block = await reader.getBlock(manifest.sourceBlock.number);
  if (!block || block.hash.toLowerCase() !== manifest.sourceBlock.hash.toLowerCase()) {
    throw new BundleError(
      `canonical block mismatch at ${manifest.sourceBlock.number}`,
    );
  }
  const logs = await reader.getLogs(
    manifest.contract,
    manifest.sourceBlock.number,
    manifest.sourceBlock.number,
  );
  const locked = {};
  for (const raw of logs) {
    const ev = decodeLog(raw);
    if (ev?.kind === 'StrategyLocked' && ev.fixtureId === Number(manifest.fixtureId)) {
      locked[ev.slot === 0 ? 'home' : 'away'] = ev.order;
    }
  }
  for (const side of ['home', 'away']) {
    if (!locked[side]) {
      throw new BundleError(`no finalized lock for ${side} at source block`);
    }
    if (JSON.stringify(locked[side]) !== JSON.stringify(manifest.lockedStrategies[side])) {
      throw new BundleError(`${side} locked order differs from bundle`);
    }
  }
  return { ok: true, boundBlock: manifest.sourceBlock.number };
}
