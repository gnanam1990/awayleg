import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureState, pathsAtTurn, reportDifference, tuplesMatch } from '../src/desk.js';

const accepted = { state: 'ACCEPTED', homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 };

describe('desk state classifier', () => {
  it('maps lifecycle to operational states', () => {
    assert.equal(fixtureState(null, {}).state, 'Loading');
    assert.equal(fixtureState(accepted, {}).state, 'Success');
    assert.equal(fixtureState({ state: 'DISPUTED' }, {}).state, 'Blocked');
    assert.equal(fixtureState({ state: 'EXPIRED' }, {}).state, 'Blocked');
    assert.equal(fixtureState({ state: 'PENDING' }, { home: { tuple: {} } }).state, 'Partial');
    assert.equal(fixtureState({ state: 'PENDING' }, {}).state, 'Empty');
  });

  it('keeps official points but warns on recomputed mismatch', () => {
    const st = fixtureState(accepted, {
      home: { tuple: { homeDelivered: 5, homeTurns: 5, awayDelivered: 4, awayTurns: 9 } },
      away: { tuple: { homeDelivered: 5, homeTurns: 5, awayDelivered: 4, awayTurns: 9 } },
    });
    assert.equal(st.state, 'Success');
    assert.equal(st.integrity, 'warn');
  });

  it('partial names the awaited referee', () => {
    const st = fixtureState({ state: 'PENDING' }, { home: { tuple: {} } });
    assert.match(st.copy, /Waiting for away referee/);
  });
});

describe('board path derivation', () => {
  it('accumulates cells through a turn', () => {
    const frames = [[0, 0, 0], [1, 6, 0], [2, 7, 1]];
    assert.deepEqual(pathsAtTurn(frames, 1), [0, 6]);
    assert.deepEqual(pathsAtTurn(frames, 2), [0, 6, 7]);
  });
});

describe('evidence drawer first difference', () => {
  it('reports missing, equal, differ, length', () => {
    assert.equal(reportDifference(null, {}).kind, 'MISSING');
    assert.equal(reportDifference({ frames: [[0, 0, 0]] }, { frames: [[0, 0, 0]] }).kind, 'EQUAL');
    const d = reportDifference({ frames: [[0, 0, 0], [1, 1, 1]] }, { frames: [[0, 0, 0], [1, 9, 1]] });
    assert.equal(d.kind, 'DIFFER');
    assert.equal(d.turn, 1);
    assert.equal(reportDifference({ frames: [[0], [1]] }, { frames: [[0]] }).kind, 'LENGTH');
  });
});
