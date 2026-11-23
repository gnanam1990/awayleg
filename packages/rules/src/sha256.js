// Node-only: SHA-256 helpers. Browser consumers must not import this module —
// desk/indexer paths use course.js + engine.js which stay crypto-free.

import { createHash } from 'node:crypto';

export function sha256Hex(bytes) {
  return `0x${createHash('sha256').update(Buffer.from(bytes)).digest('hex')}`;
}
