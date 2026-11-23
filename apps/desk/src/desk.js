// Pure desk logic — testable without React.
// Desk replays both locked strategies locally from chain-derived inputs:
// fixture row + locked orders + course artifact → frames, scores, recomputed tuple.

import { courseFromBytes } from '@awayleg/rules/course';
import { runStrategy } from '@awayleg/rules/engine';

export const GRID_W = 6;
export const GRID_H = 6;

const stateOf = (s) => String(s ?? '').toUpperCase();

// Fixture lifecycle → operational state label + copy.
export function fixtureState(fixture, reports) {
  if (!fixture) return { state: 'Loading', copy: 'Loading fixture…' };
  const s = stateOf(fixture.state);
  if (s === 'ACCEPTED') {
    const rec = reports?.recomputed;
    if (rec && !tuplesMatch(official(fixture), rec)) {
      return {
        state: 'Success',
        copy: 'Both clubs agreed',
        integrity: 'warn',
        integrityCopy:
          'Integrity warning: recomputed totals differ from the attested summary; official points follow the finalized Accepted event.',
      };
    }
    return { state: 'Success', copy: 'Both clubs agreed' };
  }
  if (s === 'DISPUTED') {
    return { state: 'Blocked', copy: 'Disputed result — clubs reported different tuples; eligible recovery is organizer review.' };
  }
  if (s === 'EXPIRED') {
    return { state: 'Blocked', copy: 'Deadline passed — attestation window closed.' };
  }
  const reported = [fixture.homeReport, fixture.awayReport].filter(Boolean).length;
  if (reported === 1) {
    const missing = fixture.homeReport ? 'away' : 'home';
    return { state: 'Partial', copy: `Waiting for ${missing} referee` };
  }
  return { state: 'Empty', copy: 'Scheduled — awaiting locked strategies and reports.' };
}

// The fixture's accepted tuple (attested summary) or, pre-terminal, a pending view.
export function official(fixture) {
  const t = fixture?.acceptedTuple ?? fixture?.homeReport ?? null;
  if (!t) return null;
  return {
    homeDelivered: Number(t.homeDelivered),
    homeTurns: Number(t.homeTurns),
    awayDelivered: Number(t.awayDelivered),
    awayTurns: Number(t.awayTurns),
  };
}

export function tuplesMatch(a, b) {
  if (!a || !b) return false;
  return (
    a.homeDelivered === b.homeDelivered &&
    a.homeTurns === b.homeTurns &&
    a.awayDelivered === b.awayDelivered &&
    a.awayTurns === b.awayTurns
  );
}

// Recompute the fixture from course bytes + locked orders.
export function recompute({ courseBytes, homeOrder, awayOrder }) {
  const course = courseFromBytes(courseBytes);
  const home = runStrategy(course, homeOrder);
  const away = runStrategy(course, awayOrder);
  return {
    homeFrames: home.frames,
    awayFrames: away.frames,
    recomputed: {
      homeDelivered: home.deliveries,
      homeTurns: home.turns,
      awayDelivered: away.deliveries,
      awayTurns: away.turns,
    },
  };
}

// Turn index → accumulated cell path (both clubs share the board).
export function pathsAtTurn(frames, upto) {
  const cells = [];
  for (const f of frames.slice(0, upto + 1)) cells.push(f[1]);
  return cells;
}

export function deliveriesOf(frame) {
  return frame ? frame[2] : 0;
}

// First difference between the two captain reports — tuples only.
export function reportDifference(homeReport, awayReport) {
  if (!homeReport || !awayReport) {
    return { kind: 'MISSING', side: !homeReport ? 'home' : 'away' };
  }
  const fields = ['replayHash', 'homeDelivered', 'homeTurns', 'awayDelivered', 'awayTurns'];
  const diff = fields.filter((k) => String(homeReport[k]) !== String(awayReport[k]));
  if (diff.length === 0) return { kind: 'EQUAL' };
  return { kind: 'DIFFER', fields: diff, home: homeReport, away: awayReport };
}

export function formatState(fixture, reports) {
  return fixtureState(fixture, reports).state;
}
