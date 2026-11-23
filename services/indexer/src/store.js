// Bounded content store: digest-addressed blobs with temp-file + atomic
// rename. A crash can leave unreferenced temp files for bounded cleanup.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';

export const LIMITS = {
  course: 64 * 1024,
  replay: 512 * 1024,
  bundle: 2 * 1024 * 1024,
};

export class ArtifactStore {
  constructor(db, dir) {
    this.db = db;
    this.dir = dir;
    this.tmpDir = join(dir, 'tmp');
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  async put(bytes, kind, expectedHash = null) {
    const limit = LIMITS[kind];
    if (!limit) throw new Error(`unknown artifact kind: ${kind}`);
    if (bytes.length === 0) throw new Error('empty artifact');
    if (bytes.length > limit) {
      throw new Error(`artifact exceeds ${limit} bytes (${bytes.length})`);
    }
    const hash = `0x${createHash('sha256').update(bytes).digest('hex')}`;
    if (expectedHash && hash !== expectedHash.toLowerCase()) {
      throw new Error(`digest mismatch: got ${hash}, expected ${expectedHash}`);
    }
    const existing = this.db
      .prepare('SELECT hash, path FROM artifacts WHERE hash = ?')
      .get(hash);
    if (existing) {
      return { hash, path: existing.path, size: bytes.length, deduplicated: true };
    }
    const tmp = join(this.tmpDir, `blob-${randomBytes(8).toString('hex')}`);
    await pipeline(
      // stream through a size/digest-enforcing write
      async function* () {
        yield bytes;
      },
      createWriteStream(tmp),
    );
    const final = join(this.dir, hash.slice(2));
    await rename(tmp, final); // atomic publish
    this.db
      .prepare('INSERT INTO artifacts (hash, size, kind, path, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(hash, bytes.length, kind, final, Date.now());
    return { hash, path: final, size: bytes.length, deduplicated: false };
  }

  async get(hash) {
    const row = this.db.prepare('SELECT path, size, kind FROM artifacts WHERE hash = ?').get(
      hash.toLowerCase(),
    );
    if (!row) return null;
    try {
      const bytes = await readFile(row.path);
      const actual = `0x${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== hash.toLowerCase()) {
        return { ...row, bytes: null, corrupt: true };
      }
      return { ...row, bytes, corrupt: false };
    } catch {
      return { ...row, bytes: null, corrupt: true };
    }
  }

  // Restore a missing/corrupt blob from a club-supplied bundle copy.
  async restore(hash, bundlePath) {
    const bytes = await readFile(bundlePath);
    const actual = `0x${createHash('sha256').update(bytes).digest('hex')}`;
    if (actual !== hash.toLowerCase()) {
      throw new Error(`bundle bytes do not match ${hash}: got ${actual}`);
    }
    const row = this.db.prepare('SELECT kind, path FROM artifacts WHERE hash = ?').get(hash.toLowerCase());
    const final = row?.path ?? join(this.dir, hash.slice(2));
    const tmp = join(this.tmpDir, `blob-${randomBytes(8).toString('hex')}`);
    await copyFile(bundlePath, tmp);
    await rename(tmp, final);
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO artifacts (hash, size, kind, path, createdAt) VALUES (?, ?, ?, ?, ?)',
        )
        .run(hash.toLowerCase(), bytes.length, 'bundle', final, Date.now());
    }
    return { hash: hash.toLowerCase(), path: final, size: bytes.length, restored: true };
  }

  async sweepTmp() {
    // bounded cleanup of crash leftovers
    try {
      const { readdir } = await import('node:fs/promises');
      const names = await readdir(this.tmpDir);
      for (const n of names) await unlink(join(this.tmpDir, n)).catch(() => {});
      return names.length;
    } catch {
      return 0;
    }
  }
}
