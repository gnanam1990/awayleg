// Finalized-log worker. Uses the RPC finalized tag, verifies chain id and the
// canonical checkpoint hash before advancing, commits cursor + projections in
// one transaction, dedupes overlap, sorts by block/tx/log order, and pauses
// publishing on checkpoint divergence until a verified ancestor resumes it.

import { decodeLog } from '@awayleg/chain';
import { backtrackTo, commitBatch, markStale } from './project.js';
import { getCursor } from './db.js';

const DEFAULT_MAX_RANGE = 500;
const MIN_RANGE = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function syncDeployment(
  db,
  source,
  deploymentId,
  { maxRange = DEFAULT_MAX_RANGE, backoffMs = 250, address } = {},
) {
  const cursor = getCursor(db, deploymentId);
  if (!cursor) throw new Error(`no cursor for deployment ${deploymentId}`);

  await source.getChainId(); // verifies expected chain

  const head = await source.getFinalizedHead();
  if (!head) {
    markStale(db, deploymentId);
    return { advanced: false, reason: 'finality-unavailable', stale: true };
  }

  // Canonical checkpoint verification (skip the deployment genesis sentinel).
  if (!cursor.hash.startsWith('genesis:')) {
    const actual = await source.getBlock(cursor.number);
    if (!actual) {
      markStale(db, deploymentId);
      return { advanced: false, reason: 'checkpoint-unreadable', stale: true };
    }
    if (actual.hash !== cursor.hash) {
      // Divergent checkpoint: pause publishing, backtrack to a common ancestor.
      markStale(db, deploymentId);
      const ancestor = await findCommonAncestor(db, source, deploymentId, cursor.number);
      if (!ancestor) {
        return { advanced: false, reason: 'no-common-ancestor', stale: true };
      }
      const orphaned = backtrackTo(db, deploymentId, ancestor.number, ancestor.hash);
      return {
        advanced: false,
        reason: 'divergence-recovered',
        stale: true,
        ancestor,
        orphaned,
      };
    }
  }

  if (head.number <= cursor.number) {
    return { advanced: false, reason: 'up-to-date', stale: false, head };
  }

  let lo = cursor.number + 1;
  let committed = 0;
  while (lo <= head.number) {
    let hi = Math.min(lo + maxRange - 1, head.number);
    let range = hi - lo + 1;
    let logs = null;
    // Bounded ranges with backoff for provider log limits.
    while (range >= MIN_RANGE) {
      hi = lo + range - 1;
      try {
        logs = await source.getLogs(address, lo, hi);
        break;
      } catch (err) {
        range = Math.floor(range / 2);
        await sleep(backoffMs);
        if (range < MIN_RANGE) {
          markStale(db, deploymentId);
          return { advanced: false, reason: `log-fetch-failed: ${err.message}`, stale: true };
        }
      }
    }
    if (logs === null) {
      markStale(db, deploymentId);
      return { advanced: false, reason: 'log-fetch-failed', stale: true };
    }

    const decoded = [];
    const seenBlocks = new Map();
    for (const raw of logs) {
      const ev = decodeLog(raw);
      if (!ev) continue;
      decoded.push({
        ...ev,
        blockNumber: raw.blockNumber,
        blockHash: raw.blockHash,
        txHash: raw.transactionHash,
        txIndex: raw.transactionIndex ?? 0,
        logIndex: raw.logIndex,
      });
      if (!seenBlocks.has(raw.blockNumber)) seenBlocks.set(raw.blockNumber, raw.blockHash);
    }
    decoded.sort(
      (a, b) => a.blockNumber - b.blockNumber || a.txIndex - b.txIndex || a.logIndex - b.logIndex,
    );

    // Record event-carrying blocks plus the range tip as cursor ancestry.
    const blocks = [];
    for (const [num, hash] of seenBlocks) {
      const meta = await source.getBlock(num);
      blocks.push({ number: num, hash, parent: meta?.parentHash ?? '' });
    }
    const tip = await source.getBlock(hi);
    if (tip) blocks.push({ number: tip.number, hash: tip.hash, parent: tip.parentHash });

    commitBatch(db, deploymentId, decoded, blocks, { number: hi, hash: tip?.hash ?? head.hash });
    committed += decoded.length;
    lo = hi + 1;
  }
  return { advanced: true, committed, stale: false, head };
}

async function findCommonAncestor(db, source, deploymentId, fromNumber) {
  const rows = db
    .prepare(
      'SELECT number, hash FROM blocks WHERE deploymentId = ? AND number <= ? ORDER BY number DESC',
    )
    .all(deploymentId, fromNumber);
  for (const row of rows) {
    if (row.hash.startsWith('genesis:')) {
      return { number: row.number, hash: row.hash };
    }
    const actual = await source.getBlock(row.number);
    if (actual && actual.hash === row.hash) {
      return { number: row.number, hash: row.hash };
    }
  }
  return null;
}
