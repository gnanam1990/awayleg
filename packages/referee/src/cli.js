// awayleg CLI: referee run / replay verify / diff / attest preview.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { ChainReader, intents } from '@awayleg/chain';
import { firstDifference, sha256Hex, tupleDiff } from '@awayleg/rules';
import { BundleError, readBundle, verifyBundle, verifyBinding } from './bundle.js';
import { refereeRun } from './runner.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else out[key] = next;
      if (next !== undefined && !next.startsWith('--')) i++;
    } else out._.push(a);
  }
  return out;
}

const USAGE = `awayleg — portable club referee

  awayleg referee run --chain <id> --contract <0x..> --fixture <id>
      --course <course.json> --out <bundle-dir> [--rpc <url>] [--at-finalized <block>] [--registry <0x..>]

  awayleg replay verify --bundle <dir> [--rpc <url>] [--contract <0x..>]

  awayleg diff --a <replay-or-bundle> --b <replay-or-bundle>

  awayleg attest --contract <0x..> --fixture <id> --bundle <dir>
      (prints the decoded wallet intent for local preview)
`;

function loadReplayFrames(path) {
  if (!existsSync(path)) return null;
  let bytes;
  if (statSync(path).isDirectory()) {
    const { replayBytes } = readBundle(path);
    bytes = replayBytes;
  } else {
    bytes = readFileSync(path);
  }
  const arr = JSON.parse(bytes.toString('utf8'));
  return { home: arr[7], away: arr[8] };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const [cmd, sub] = args._;

  if (cmd === 'referee' && sub === 'run') {
    const rpc = args.rpc ?? 'http://127.0.0.1:8545';
    const reader = new ChainReader(rpc, Number(args.chain));
    const res = await refereeRun({
      reader,
      chainId: Number(args.chain),
      contract: args.contract,
      fixtureId: args.fixture,
      atFinalized: args['at-finalized'] != null ? Number(args['at-finalized']) : null,
      coursePath: args.course,
      outDir: args.out ?? 'evidence/bundle',
      registry: args.registry,
    });
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }

  if (cmd === 'replay' && sub === 'verify') {
    const v = verifyBundle(args.bundle);
    console.log(`replayHash ${v.replayHash}`);
    console.log(`outcome    ${v.outcome}`);
    console.log(`home       ${v.tuple.homeDelivered} deliveries in ${v.tuple.homeTurns} turns`);
    console.log(`away       ${v.tuple.awayDelivered} deliveries in ${v.tuple.awayTurns} turns`);
    if (args.rpc) {
      const reader = new ChainReader(args.rpc, v.manifest.chainId);
      const bound = await verifyBinding(args.bundle, reader, args.contract ?? v.manifest.contract);
      console.log(`chain bind ok at block ${bound.boundBlock}`);
    }
    console.log('OFFLINE VERIFY OK');
    return 0;
  }

  if (cmd === 'diff') {
    const a = loadReplayFrames(args.a);
    const b = loadReplayFrames(args.b);
    const result = {
      home: firstDifference(a?.home, b?.home),
      away: firstDifference(a?.away, b?.away),
    };
    for (const side of ['home', 'away']) {
      const r = result[side];
      if (r.kind === 'DIFFER') {
        console.log(`${side}: first differing frame at turn ${r.turn}: ${JSON.stringify(r.a)} vs ${JSON.stringify(r.b)}`);
      } else if (r.kind === 'LENGTH') {
        console.log(`${side}: traces diverge at turn ${r.turn} (length mismatch)`);
      } else if (r.kind === 'MISSING') {
        console.log(`${side}: trace missing (${r.side}) — cannot establish a divergence turn`);
      } else {
        console.log(`${side}: traces identical`);
      }
    }
    return 0;
  }

  if (cmd === 'attest') {
    const { manifest } = readBundle(args.bundle);
    const tuple = {
      replayHash: manifest.replayHash,
      homeDelivered: manifest.scores.home.delivered,
      homeTurns: manifest.scores.home.turns,
      awayDelivered: manifest.scores.away.delivered,
      awayTurns: manifest.scores.away.turns,
    };
    const intent = intents(args.contract).attest(args.fixture, tuple);
    console.log('decoded wallet intent (nonpayable, user-confirmed):');
    console.log(JSON.stringify(intent, null, 2));
    return 0;
  }

  process.stdout.write(USAGE);
  return cmd ? 2 : 0;
}
