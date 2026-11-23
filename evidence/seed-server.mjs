// Seed a persistent indexer DB + artifact dir from the live anvil deployment,
// then serve the API on :3000 for the desk.
import { readFileSync, mkdirSync } from 'node:fs';
import { ensureDeployment, openDb } from '../services/indexer/src/db.js';
import { ArtifactStore } from '../services/indexer/src/store.js';
import { ViemSource } from '../services/indexer/src/source.js';
import { syncDeployment } from '../services/indexer/src/worker.js';
import { serve } from '../services/indexer/src/server.js';
import { createHash } from 'node:crypto';

const SEASON = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const DB = process.env.AWAYLEG_DB ?? '/tmp/awayleg-pilot/indexer.db';
const ARTS = process.env.AWAYLEG_ARTIFACTS ?? '/tmp/awayleg-pilot/artifacts';
mkdirSync('/tmp/awayleg-pilot', { recursive: true });

const db = openDb(DB);
const depId = ensureDeployment(db, { chainId: 31337, address: SEASON, startBlock: 0 });
const source = new ViemSource('http://127.0.0.1:8545', 31337);
const r = await syncDeployment(db, source, depId);
console.log('sync:', JSON.stringify(r));

const corridor = JSON.parse(readFileSync(new URL('../fixtures/corridor.json', import.meta.url)));
const courseBytes = Buffer.from(JSON.stringify(corridor.course), 'utf8');
const store = new ArtifactStore(db, ARTS);
await store.init();
const put = await store.put(courseBytes, 'course');
console.log('course artifact:', put.hash);

await serve({ dbPath: DB, artifactDir: ARTS, port: Number(process.env.PORT ?? 3000) });
console.log('serving seeded indexer for desk');
