// SQLite projections in WAL mode. Cursor and projection writes commit in one
// transaction; an interruption rolls the whole batch back, so replay is safe.

import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 1;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS deployments (
      deploymentId INTEGER PRIMARY KEY AUTOINCREMENT,
      chainId INTEGER NOT NULL,
      address TEXT NOT NULL,
      startBlock INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      UNIQUE (chainId, address)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      deploymentId INTEGER NOT NULL,
      number INTEGER NOT NULL,
      hash TEXT NOT NULL,
      parent TEXT NOT NULL,
      PRIMARY KEY (deploymentId, number)
    );
    CREATE TABLE IF NOT EXISTS events (
      deploymentId INTEGER NOT NULL,
      blockNumber INTEGER NOT NULL,
      blockHash TEXT NOT NULL,
      txHash TEXT NOT NULL,
      logIndex INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (deploymentId, txHash, logIndex)
    );
    CREATE TABLE IF NOT EXISTS orphaned_events (
      deploymentId INTEGER NOT NULL,
      blockNumber INTEGER NOT NULL,
      blockHash TEXT NOT NULL,
      txHash TEXT NOT NULL,
      logIndex INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      orphanedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fixtures (
      deploymentId INTEGER NOT NULL,
      id INTEGER NOT NULL,
      scheduleKey TEXT NOT NULL,
      courseHash TEXT NOT NULL,
      homeEntrant TEXT NOT NULL,
      awayEntrant TEXT NOT NULL,
      homeCaptain TEXT NOT NULL,
      awayCaptain TEXT NOT NULL,
      entryClose INTEGER NOT NULL,
      attestClose INTEGER NOT NULL,
      state TEXT NOT NULL,
      outcome TEXT,
      acceptedTuple TEXT,
      homeReport TEXT,
      awayReport TEXT,
      homeReported INTEGER NOT NULL DEFAULT 0,
      awayReported INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (deploymentId, id)
    );
    CREATE TABLE IF NOT EXISTS slots (
      deploymentId INTEGER NOT NULL,
      fixtureId INTEGER NOT NULL,
      role TEXT NOT NULL,
      entrant TEXT NOT NULL,
      lockedOrder TEXT,
      PRIMARY KEY (deploymentId, fixtureId, role)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cursor (
      deploymentId INTEGER PRIMARY KEY,
      number INTEGER NOT NULL,
      hash TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
    'schemaVersion',
    String(SCHEMA_VERSION),
  );
}

export function ensureDeployment(db, { chainId, address, startBlock }) {
  const addr = address.toLowerCase();
  const row = db
    .prepare('SELECT deploymentId, startBlock FROM deployments WHERE chainId = ? AND address = ?')
    .get(chainId, addr);
  if (row) return row.deploymentId;
  const res = db
    .prepare(
      'INSERT INTO deployments (chainId, address, startBlock, createdAt) VALUES (?, ?, ?, ?)',
    )
    .run(chainId, addr, startBlock, Date.now());
  const deploymentId = Number(res.lastInsertRowid);
  db.prepare(
    'INSERT OR IGNORE INTO blocks (deploymentId, number, hash, parent) VALUES (?, ?, ?, ?)',
  ).run(deploymentId, startBlock - 1, 'genesis:' + addr, '');
  db.prepare(
    'INSERT OR IGNORE INTO cursor (deploymentId, number, hash, stale) VALUES (?, ?, ?, 0)',
  ).run(deploymentId, startBlock - 1, 'genesis:' + addr);
  return deploymentId;
}

export function getCursor(db, deploymentId) {
  return db
    .prepare('SELECT number, hash, stale FROM cursor WHERE deploymentId = ?')
    .get(deploymentId);
}

export function listDeployments(db) {
  return db
    .prepare('SELECT deploymentId, chainId, address, startBlock FROM deployments ORDER BY deploymentId')
    .all();
}

export function eventsAbove(db, deploymentId, number) {
  return db
    .prepare(
      'SELECT blockNumber, blockHash, txHash, logIndex, kind, payload FROM events WHERE deploymentId = ? AND blockNumber > ? ORDER BY blockNumber, logIndex',
    )
    .all(deploymentId, number);
}
