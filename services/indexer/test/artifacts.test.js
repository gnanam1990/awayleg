// T-010 Artifact limits and restoration: malformed or oversized course,
// digest enforcement, same-hash dedup, restore from a club bundle copy.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { ArtifactStore, LIMITS } from '../src/store.js';
import { courseBytes } from '@awayleg/rules';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'awayleg-art-'));
  const db = openDb(join(dir, 'index.db'));
  const store = new ArtifactStore(db, join(dir, 'blobs'));
  return { db, store, dir };
}

const VALID_COURSE = Buffer.from('[1,6,6,0,[],[1,2,3,4,5]]', 'utf8');

describe('T-010 artifact limits and restoration', () => {
  it('stores a valid course keyed by digest', async () => {
    const { store } = setup();
    await store.init();
    const courseHash = '0x3de7c3c6dfc61070fbaa0fc30ef3bbd01741ccb7a31492fa72bcf9ad9cbb5c95';
    const r = await store.put(VALID_COURSE, 'course', courseHash);
    assert.equal(r.hash, courseHash);
    assert.equal(r.deduplicated, false);
    assert.ok(existsSync(r.path));
  });

  it('rejects oversized and empty blobs', async () => {
    const { store } = setup();
    await store.init();
    const big = Buffer.alloc(LIMITS.course + 1);
    await assert.rejects(() => store.put(big, 'course'), /exceeds/);
    await assert.rejects(() => store.put(Buffer.alloc(0), 'course'), /empty/);
  });

  it('rejects digest mismatches at ingress', async () => {
    const { store } = setup();
    await store.init();
    await assert.rejects(
      () => store.put(VALID_COURSE, 'course', '0x' + 'ff'.repeat(32)),
      /digest mismatch/,
    );
  });

  it('same-hash repeat returns the same bytes (dedup)', async () => {
    const { store } = setup();
    await store.init();
    const a = await store.put(VALID_COURSE, 'course');
    const b = await store.put(VALID_COURSE, 'course');
    assert.equal(b.deduplicated, true);
    assert.equal(a.hash, b.hash);
    assert.equal(a.path, b.path);
  });

  it('restores a missing blob from a club bundle copy', async () => {
    const { store, dir } = setup();
    await store.init();
    const r = await store.put(VALID_COURSE, 'course');
    // Delete the blob file to simulate loss.
    unlinkSync(r.path);
    assert.ok(!existsSync(r.path));
    const got = await store.get(r.hash);
    assert.equal(got.corrupt, true);
    // Club supplies its copy.
    const bundlePath = join(dir, 'club-copy-course.json');
    writeFileSync(bundlePath, VALID_COURSE);
    const restored = await store.restore(r.hash, bundlePath);
    assert.equal(restored.restored, true);
    const after = await store.get(r.hash);
    assert.equal(after.corrupt, false);
    assert.deepEqual(after.bytes, VALID_COURSE);
    // canonical bytes still encode the same course
    assert.equal(courseBytes(VALID_COURSE && JSON.parse(VALID_COURSE.toString('utf8'))).toString('utf8'), VALID_COURSE.toString('utf8'));
  });

  it('rejects a bundle whose bytes do not match the requested hash', async () => {
    const { store, dir } = setup();
    await store.init();
    const r = await store.put(VALID_COURSE, 'course');
    const bad = join(dir, 'wrong.json');
    writeFileSync(bad, '[1,6,6,0,[],[9,2,3,4,5]]');
    await assert.rejects(() => store.restore(r.hash, bad), /do not match/);
  });
});
