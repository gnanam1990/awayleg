// Read-only spectator HTTP API + bounded artifact ingress.
// Standings and fixture views derive from finalized events only; a stale flag
// rides every response so cached lag stays visible.

import { createServer } from 'node:http';
import { ensureDeployment, getCursor, listDeployments, openDb } from './db.js';
import { listFixtures, listSlots, standings, STATE } from './project.js';
import { ArtifactStore } from './store.js';
import { ViemSource } from './source.js';
import { syncDeployment } from './worker.js';
import { courseFromBytes } from '@awayleg/rules';

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(data);
}

async function readBody(req, cap = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function createApi({ dbPath = ':memory:', artifactDir, sourceFactory }) {
  const db = openDb(dbPath);
  const store = new ArtifactStore(db, artifactDir ?? '/tmp/awayleg-artifacts');
  const state = { db, store };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const parts = path.split('/').filter(Boolean);

      if (req.method === 'GET' && path === '/api/status') {
        const deployments = listDeployments(db).map((d) => ({
          ...d,
          cursor: getCursor(db, d.deploymentId) ?? null,
        }));
        return json(res, 200, { deployments });
      }

      if (req.method === 'POST' && path === '/api/deployments') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const id = ensureDeployment(db, {
          chainId: body.chainId,
          address: body.address,
          startBlock: body.startBlock ?? 0,
        });
        return json(res, 201, { deploymentId: id });
      }

      if (req.method === 'POST' && parts.join('/') === 'api/sync') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const dep = listDeployments(db).find(
          (d) => d.deploymentId === body.deploymentId || (d.chainId === body.chainId && d.address === body.address?.toLowerCase()),
        );
        if (!dep) return json(res, 404, { error: 'unknown deployment' });
        const source = sourceFactory ? sourceFactory(dep) : new ViemSource(body.rpcUrl, dep.chainId);
        const result = await syncDeployment(db, source, dep.deploymentId, {
          address: dep.address,
          maxRange: body.maxRange,
        });
        return json(res, 200, result);
      }

      if (req.method === 'GET' && parts.join('/') === 'api/fixtures') {
        const depId = Number(url.searchParams.get('deployment') ?? '1');
        const cursor = getCursor(db, depId);
        const fixtures = listFixtures(db, depId).map((f) => ({
          id: f.id,
          state: f.state,
          outcome: f.outcome,
          courseHash: f.courseHash,
          homeEntrant: f.homeEntrant,
          awayEntrant: f.awayEntrant,
          homeCaptain: f.homeCaptain,
          awayCaptain: f.awayCaptain,
          entryClose: f.entryClose,
          attestClose: f.attestClose,
          homeReported: f.homeReported,
          awayReported: f.awayReported,
        }));
        return json(res, 200, {
          fixtures,
          stale: !!cursor?.stale,
          height: cursor?.number ?? null,
        });
      }

      if (req.method === 'GET' && parts[1] === 'fixtures' && parts.length === 3) {
        const depId = Number(url.searchParams.get('deployment') ?? '1');
        const id = Number(parts[2]);
        const fixture = listFixtures(db, depId).find((f) => f.id === id);
        if (!fixture) return json(res, 404, { error: 'unknown fixture' });
        const slots = listSlots(db, depId, id);
        const cursor = getCursor(db, depId);
        return json(res, 200, {
          fixture,
          slots,
          stale: !!cursor?.stale,
          height: cursor?.number ?? null,
        });
      }

      if (req.method === 'GET' && path === '/api/standings') {
        const depId = Number(url.searchParams.get('deployment') ?? '1');
        const cursor = getCursor(db, depId);
        return json(res, 200, {
          ...standings(db, depId),
          stale: !!cursor?.stale,
          height: cursor?.number ?? null,
        });
      }

      if (req.method === 'POST' && path === '/api/artifacts') {
        const body = await readBody(req);
        const parsed = JSON.parse(body.toString('utf8'));
        const bytes = Buffer.from(parsed.bytes.replace(/^0x/, ''), 'hex');
        // Validate courses at ingress (INV-03: unknown stays unresolved).
        if (parsed.kind === 'course') courseFromBytes(bytes);
        const result = await store.put(bytes, parsed.kind, parsed.hash ?? null);
        return json(res, 201, result);
      }

      if (req.method === 'GET' && parts[1] === 'artifacts' && parts.length === 3) {
        const found = await store.get(parts[2]);
        if (!found) return json(res, 404, { error: 'unknown artifact' });
        if (found.corrupt || !found.bytes) {
          return json(res, 409, { error: 'artifact missing or corrupt', kind: found.kind });
        }
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        return res.end(found.bytes);
      }

      if (req.method === 'POST' && parts.join('/') === 'api/artifacts/restore') {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        const bytes = Buffer.from(body.bytes.replace(/^0x/, ''), 'hex');
        const tmpPath = `/tmp/restore-${Date.now()}`;
        const { writeFile } = await import('node:fs/promises');
        await writeFile(tmpPath, bytes);
        const result = await store.restore(body.hash, tmpPath);
        return json(res, 200, result);
      }

      if (req.method === 'GET' && path === '/api/health') {
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const code = /unknown|not found/.test(err.message)
        ? 404
        : /too large|exceeds|invalid|mismatch|empty/.test(err.message)
          ? 400
          : 500;
      return json(res, code, { error: err.message });
    }
  });

  return { server, db, store, state };
}

export async function serve(opts) {
  const { server, db, store } = createApi(opts);
  await store.init();
  const port = opts.port ?? 8787;
  await new Promise((r) => server.listen(port, r));
  console.log(`awayleg indexer on :${port}`);
  return { server, db, store, port };
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  serve({
    dbPath: process.env.AWAYLEG_DB ?? ':memory:',
    artifactDir: process.env.AWAYLEG_ARTIFACTS ?? '/tmp/awayleg-artifacts',
    port: Number(process.env.PORT ?? 8787),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
