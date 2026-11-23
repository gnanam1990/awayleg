// M06 sync: index the real anvil deployment + compute T-018 counts.
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDeployment, openDb } from '../services/indexer/src/db.js';
import { listFixtures, listSlots, standings } from '../services/indexer/src/project.js';
import { ViemSource } from '../services/indexer/src/source.js';
import { syncDeployment } from '../services/indexer/src/worker.js';

const SEASON = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const REG = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

const dir = mkdtempSync(join(tmpdir(), 'awayleg-pilot-'));
const db = openDb(join(dir, 'pilot.db'));
const depId = ensureDeployment(db, { chainId: 31337, address: SEASON, startBlock: 0 });
const source = new ViemSource('http://127.0.0.1:8545', 31337);
await syncDeployment(db, source, depId);

const fixtures = listFixtures(db, depId);
console.log('fixtures:', JSON.stringify(fixtures.map((f) => ({ id: f.id, state: f.state, outcome: f.outcome, homeDelivered: f.homeDelivered, homeTurns: f.homeTurns, awayDelivered: f.awayDelivered, awayTurns: f.awayTurns }))));
const slots = listSlots(db, depId, 5);
console.log('slots:', JSON.stringify(slots));
const table = standings(db, depId);
console.log('standings:', JSON.stringify(table));

// T-018 window and holder counts — dedup addresses across fixtures.
const entrants = new Set();
const captains = new Set();
const holders = new Set();
let accepted = 0;
for (const f of fixtures) {
  entrants.add(f.homeEntrant.toLowerCase());
  entrants.add(f.awayEntrant.toLowerCase());
  holders.add(f.homeEntrant.toLowerCase());
  holders.add(f.awayEntrant.toLowerCase());
  captains.add(f.homeCaptain?.toLowerCase?.() ?? '');
  captains.add(f.awayCaptain?.toLowerCase?.() ?? '');
  if (String(f.state) === 'Accepted') accepted++;
}
console.log('T-018 counts:', JSON.stringify({
  distinctEntrants: entrants.size,
  captains: [...captains].filter(Boolean).length,
  uniqueKnownHolders: holders.size,
  acceptedFixtures: accepted,
  totalFixtures: fixtures.length,
}));
