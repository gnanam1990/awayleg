// Event -> projection application. Standings derive from terminal fixture
// states at read time; retries never add points twice.

import { points } from '@awayleg/rules';

export const STATE = {
  Open: 'Open',
  Accepted: 'Accepted',
  Disputed: 'Disputed',
  Expired: 'Expired',
};

export function applyEvent(db, deploymentId, event) {
  switch (event.kind) {
    case 'FixtureCreated': {
      db.prepare(
        `INSERT OR IGNORE INTO fixtures
          (deploymentId, id, scheduleKey, courseHash, homeEntrant, awayEntrant,
           homeCaptain, awayCaptain, entryClose, attestClose, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deploymentId,
        event.fixtureId,
        event.scheduleKey,
        event.courseHash,
        event.homeEntrant,
        event.awayEntrant,
        event.homeCaptain,
        event.awayCaptain,
        event.entryClose,
        event.attestClose,
        STATE.Open,
      );
      db.prepare(
        `INSERT OR IGNORE INTO slots (deploymentId, fixtureId, role, entrant)
         VALUES (?, ?, 'home', ?), (?, ?, 'away', ?)`,
      ).run(deploymentId, event.fixtureId, event.homeEntrant, deploymentId, event.fixtureId, event.awayEntrant);
      break;
    }
    case 'StrategyLocked': {
      const role = event.slot === 0 ? 'home' : 'away';
      db.prepare(
        'UPDATE slots SET lockedOrder = ? WHERE deploymentId = ? AND fixtureId = ? AND role = ?',
      ).run(JSON.stringify(event.order), deploymentId, event.fixtureId, role);
      break;
    }
    case 'Attested': {
      const f = db
        .prepare(
          'SELECT homeCaptain, awayCaptain FROM fixtures WHERE deploymentId = ? AND id = ?',
        )
        .get(deploymentId, event.fixtureId);
      if (!f) break; // unfinalized/unknown stays unresolved (INV-03)
      const tuple = JSON.stringify({
        replayHash: event.replayHash,
        homeDelivered: event.homeDelivered,
        homeTurns: event.homeTurns,
        awayDelivered: event.awayDelivered,
        awayTurns: event.awayTurns,
      });
      if (event.captain === f.homeCaptain) {
        db.prepare(
          'UPDATE fixtures SET homeReport = ?, homeReported = 1 WHERE deploymentId = ? AND id = ?',
        ).run(tuple, deploymentId, event.fixtureId);
      } else if (event.captain === f.awayCaptain) {
        db.prepare(
          'UPDATE fixtures SET awayReport = ?, awayReported = 1 WHERE deploymentId = ? AND id = ?',
        ).run(tuple, deploymentId, event.fixtureId);
      }
      break;
    }
    case 'Accepted': {
      db.prepare(
        `UPDATE fixtures SET state = ?, outcome = ?, acceptedTuple = ?
         WHERE deploymentId = ? AND id = ? AND state = ?`,
      ).run(
        STATE.Accepted,
        event.outcome,
        JSON.stringify({
          replayHash: event.replayHash,
          homeDelivered: event.homeDelivered,
          homeTurns: event.homeTurns,
          awayDelivered: event.awayDelivered,
          awayTurns: event.awayTurns,
        }),
        deploymentId,
        event.fixtureId,
        STATE.Open,
      );
      break;
    }
    case 'Disputed': {
      db.prepare(
        `UPDATE fixtures SET state = ?, homeReport = ?, awayReport = ?,
           homeReported = 1, awayReported = 1
         WHERE deploymentId = ? AND id = ? AND state = ?`,
      ).run(
        STATE.Disputed,
        JSON.stringify(event.homeReport),
        JSON.stringify(event.awayReport),
        deploymentId,
        event.fixtureId,
        STATE.Open,
      );
      break;
    }
    case 'Expired': {
      db.prepare(
        'UPDATE fixtures SET state = ? WHERE deploymentId = ? AND id = ? AND state = ?',
      ).run(STATE.Expired, deploymentId, event.fixtureId, STATE.Open);
      break;
    }
  }
}

// Applies a batch inside one transaction and commits cursor + events +
// projections atomically. Events already stored are skipped (dedup), then
// still applied idempotently-safe: INSERT OR IGNORE keeps one copy, but the
// fixture update replays — terminal states guard with state = 'Open'.
export function commitBatch(db, deploymentId, events, blocks, cursor) {
  db.exec('BEGIN');
  try {
    const insEvent = db.prepare(
      `INSERT OR IGNORE INTO events
        (deploymentId, blockNumber, blockHash, txHash, logIndex, kind, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insBlock = db.prepare(
      'INSERT OR REPLACE INTO blocks (deploymentId, number, hash, parent) VALUES (?, ?, ?, ?)',
    );
    for (const b of blocks) {
      insBlock.run(deploymentId, b.number, b.hash, b.parent);
    }
    for (const e of events) {
      const { raw, ...normalized } = e; // raw args carry BigInt — not JSON-safe
      const res = insEvent.run(
        deploymentId,
        e.blockNumber,
        e.blockHash,
        e.txHash,
        e.logIndex,
        e.kind,
        JSON.stringify(normalized),
      );
      if (Number(res.changes) > 0) {
        applyEvent(db, deploymentId, e);
      }
    }
    db.prepare('UPDATE cursor SET number = ?, hash = ?, stale = 0 WHERE deploymentId = ?').run(
      cursor.number,
      cursor.hash,
      deploymentId,
    );
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Divergence recovery: orphan blocks/events above the common ancestor, reset
// fixture/slot projections and replay the surviving event log in order.
// Orphaned rows are preserved in orphaned_events, outside scoring.
export function backtrackTo(db, deploymentId, ancestorNumber, ancestorHash) {
  db.exec('BEGIN');
  try {
    const orphans = db
      .prepare(
        `SELECT blockNumber, blockHash, txHash, logIndex, kind, payload
         FROM events WHERE deploymentId = ? AND blockNumber > ?`,
      )
      .all(deploymentId, ancestorNumber);
    const insOrphan = db.prepare(
      `INSERT INTO orphaned_events
        (deploymentId, blockNumber, blockHash, txHash, logIndex, kind, payload, orphanedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const o of orphans) {
      insOrphan.run(
        deploymentId,
        o.blockNumber,
        o.blockHash,
        o.txHash,
        o.logIndex,
        o.kind,
        o.payload,
        Date.now(),
      );
    }
    db.prepare('DELETE FROM events WHERE deploymentId = ? AND blockNumber > ?').run(
      deploymentId,
      ancestorNumber,
    );
    db.prepare('DELETE FROM blocks WHERE deploymentId = ? AND number > ?').run(
      deploymentId,
      ancestorNumber,
    );
    db.prepare('DELETE FROM fixtures WHERE deploymentId = ?').run(deploymentId);
    db.prepare('DELETE FROM slots WHERE deploymentId = ?').run(deploymentId);

    const surviving = db
      .prepare(
        `SELECT kind, payload FROM events WHERE deploymentId = ?
         ORDER BY blockNumber, txHash, logIndex`,
      )
      .all(deploymentId);
    for (const row of surviving) {
      const parsed = JSON.parse(row.payload);
      applyEvent(db, deploymentId, { kind: row.kind, ...parsed });
    }
    db.prepare('UPDATE cursor SET number = ?, hash = ?, stale = 1 WHERE deploymentId = ?').run(
      ancestorNumber,
      ancestorHash,
      deploymentId,
    );
    db.exec('COMMIT');
    return orphans.length;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function markStale(db, deploymentId) {
  db.prepare('UPDATE cursor SET stale = 1 WHERE deploymentId = ?').run(deploymentId);
}

export function listFixtures(db, deploymentId) {
  return db
    .prepare('SELECT * FROM fixtures WHERE deploymentId = ? ORDER BY id')
    .all(deploymentId)
    .map((f) => ({
      ...f,
      homeReported: !!f.homeReported,
      awayReported: !!f.awayReported,
      homeReport: f.homeReport ? JSON.parse(f.homeReport) : null,
      awayReport: f.awayReport ? JSON.parse(f.awayReport) : null,
      acceptedTuple: f.acceptedTuple ? JSON.parse(f.acceptedTuple) : null,
    }));
}

export function listSlots(db, deploymentId, fixtureId) {
  return db
    .prepare(
      "SELECT role, entrant, lockedOrder FROM slots WHERE deploymentId = ? AND fixtureId = ? ORDER BY CASE role WHEN 'home' THEN 0 ELSE 1 END",
    )
    .all(deploymentId, fixtureId)
    .map((s) => ({ ...s, lockedOrder: s.lockedOrder ? JSON.parse(s.lockedOrder) : null }));
}

// Season standings derive once per accepted fixture (INV: no additive drift).
export function standings(db, deploymentId) {
  const rows = db
    .prepare(
      'SELECT outcome, homeEntrant, awayEntrant FROM fixtures WHERE deploymentId = ? AND state = ?',
    )
    .all(deploymentId, STATE.Accepted);
  let home = 0;
  let away = 0;
  for (const r of rows) {
    const p = points(r.outcome === 'HomeWin' ? 'HOME_WIN' : r.outcome === 'AwayWin' ? 'AWAY_WIN' : 'DRAW');
    home += p.home;
    away += p.away;
  }
  const counts = db
    .prepare('SELECT state, COUNT(*) n FROM fixtures WHERE deploymentId = ? GROUP BY state')
    .all(deploymentId);
  const distinctEntrants = db
    .prepare(
      'SELECT COUNT(DISTINCT entrant) n FROM slots WHERE deploymentId = ? AND lockedOrder IS NOT NULL',
    )
    .get(deploymentId).n;
  return {
    home,
    away,
    accepted: rows.length,
    counts: Object.fromEntries(counts.map((c) => [c.state, c.n])),
    distinctLockedEntrants: distinctEntrants,
  };
}
