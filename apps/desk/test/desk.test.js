import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureState, pathsAtTurn, recompute, reportDifference, tuplesMatch, official } from '../src/desk.js';

const accepted = {
  state: 'Accepted',
  acceptedTuple: { replayHash: '0x5bc5', homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 },
};

describe('desk state classifier', () => {
  it('maps lifecycle to operational states (indexer title-case)', () => {
    assert.equal(fixtureState(null, {}).state, 'Loading');
    assert.equal(fixtureState(accepted, {}).state, 'Success');
    assert.equal(fixtureState({ state: 'Disputed' }, {}).state, 'Blocked');
    assert.equal(fixtureState({ state: 'Expired' }, {}).state, 'Blocked');
    assert.equal(fixtureState({ state: 'Open', homeReport: {} }, {}).state, 'Partial');
    assert.equal(fixtureState({ state: 'Open' }, {}).state, 'Empty');
  });

  it('keeps official points but warns on recomputed mismatch', () => {
    const st = fixtureState(accepted, {
      recomputed: { homeDelivered: 5, homeTurns: 5, awayDelivered: 4, awayTurns: 9 },
    });
    assert.equal(st.state, 'Success');
    assert.equal(st.integrity, 'warn');
    assert.match(st.integrityCopy, /official points follow/);
  });

  it('partial names the awaited referee', () => {
    const st = fixtureState({ state: 'Open', homeReport: {} }, {});
    assert.match(st.copy, /Waiting for away referee/);
  });
});

describe('local replay recomputation', () => {
  const courseBytes = new TextEncoder().encode('[1,6,6,0,[],[1,2,3,4,5]]');
  it('replays both locked orders from course bytes', () => {
    const r = recompute({ courseBytes, homeOrder: [0, 1, 2, 3, 4], awayOrder: [4, 3, 2, 1, 0] });
    assert.equal(r.recomputed.homeDelivered, 5);
    assert.equal(r.recomputed.homeTurns, 5);
    assert.equal(r.recomputed.awayDelivered, 5);
    assert.equal(r.recomputed.awayTurns, 9);
    assert.equal(r.homeFrames.at(-1)[2], 5);
    assert.equal(r.awayFrames.at(-1)[0], 9);
  });
});

describe('board path derivation', () => {
  it('accumulates cells through a turn', () => {
    const frames = [[0, 0, 0], [1, 6, 0], [2, 7, 1]];
    assert.deepEqual(pathsAtTurn(frames, 1), [0, 6]);
    assert.deepEqual(pathsAtTurn(frames, 2), [0, 6, 7]);
  });
});

describe('evidence drawer report difference', () => {
  const r1 = { replayHash: '0xaa', homeDelivered: 5, homeTurns: 5, awayDelivered: 5, awayTurns: 9 };
  it('reports missing, equal, and field-level differ', () => {
    assert.equal(reportDifference(null, r1).kind, 'MISSING');
    assert.equal(reportDifference(r1, { ...r1 }).kind, 'EQUAL');
    const d = reportDifference(r1, { ...r1, awayTurns: 10 });
    assert.equal(d.kind, 'DIFFER');
    assert.deepEqual(d.fields, ['awayTurns']);
  });
});

describe('official summary', () => {
  it('prefers acceptedTuple, falls back to home report', () => {
    assert.deepEqual(official(accepted).homeDelivered, 5);
    assert.equal(official({ homeReport: { homeDelivered: 1, homeTurns: 2, awayDelivered: 3, awayTurns: 4 } }).awayTurns, 4);
    assert.equal(official({}), null);
  });
});
