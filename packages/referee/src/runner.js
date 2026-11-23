// Referee run: read finalized chain inputs, replay both strategies locally,
// emit a portable bundle and the captain's attestation tuple/intent.

import { decodeLog, intents } from '@awayleg/chain';
import { courseFromBytes } from '@awayleg/rules';
import { manifestFor, replayFixture, writeBundle } from './bundle.js';
import { readFileSync } from 'node:fs';

export async function refereeRun({
  reader,
  chainId,
  contract,
  fixtureId,
  atFinalized,
  coursePath,
  outDir,
  registry,
}) {
  const chain = await reader.getChainId();
  if (chain !== chainId) throw new Error(`chain ${chain} != requested ${chainId}`);

  const head = atFinalized != null
    ? { number: atFinalized, hash: (await reader.getBlock(atFinalized))?.hash }
    : await reader.getFinalizedHead();
  if (!head?.hash) throw new Error('cannot establish finalized source block');

  const logs = await reader.getLogs(contract, 0, head.number);
  let created = null;
  const locks = {};
  const txRefs = [];
  for (const raw of logs) {
    const ev = decodeLog(raw);
    if (!ev) continue;
    if (ev.kind === 'FixtureCreated' && ev.fixtureId === Number(fixtureId)) {
      created = ev;
    }
    if (ev.kind === 'StrategyLocked' && ev.fixtureId === Number(fixtureId)) {
      locks[ev.slot === 0 ? 'home' : 'away'] = ev.order;
      txRefs.push({
        kind: 'StrategyLocked',
        txHash: raw.transactionHash,
        logIndex: raw.logIndex,
        blockNumber: raw.blockNumber,
      });
    }
  }
  if (!created) throw new Error(`fixture ${fixtureId} not found in finalized logs`);
  if (!locks.home || !locks.away) {
    throw new Error(`fixture ${fixtureId}: missing locked strategy (home=${!!locks.home} away=${!!locks.away})`);
  }

  const courseBytes = readFileSync(coursePath);
  const course = courseFromBytes(courseBytes);
  const courseHash = `0x${(await import('node:crypto')).createHash('sha256').update(courseBytes).digest('hex')}`;
  if (courseHash !== created.courseHash.toLowerCase()) {
    throw new Error(`course file hash ${courseHash} != scheduled ${created.courseHash}`);
  }

  const replay = replayFixture({
    chainId,
    contract,
    fixtureId,
    courseBytes,
    homeOrder: locks.home,
    awayOrder: locks.away,
  });

  const manifest = manifestFor({
    chainId,
    contract,
    fixtureId,
    sourceBlock: head,
    courseHash,
    entrants: { home: created.homeEntrant, away: created.awayEntrant },
    captains: { home: created.homeCaptain, away: created.awayCaptain },
    lockedStrategies: { home: locks.home, away: locks.away },
    registry: registry ?? '0x0000000000000000000000000000000000000000',
    txRefs,
    replay,
  });
  writeBundle(outDir, manifest, courseBytes, replay.replayBytes);

  const intent = intents(contract).attest(fixtureId, replay.tuple);
  return {
    bundle: outDir,
    manifest,
    replayHash: replay.replayHash,
    outcome: replay.outcome,
    tuple: replay.tuple,
    intent,
  };
}
