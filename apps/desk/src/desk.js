// Pure desk logic — testable without React.

export const GRID_W = 6;
export const GRID_H = 6;

// Fixture lifecycle → operational state label + copy.
export function fixtureState(fixture, reports) {
  if (!fixture) return { state: 'Loading', copy: 'Loading fixture…' };
  if (fixture.state === 'ACCEPTED' || fixture.state === 'accepted') {
    const rec = recomputed(reports);
    if (rec && !tuplesMatch(fixture, rec)) {
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
  if (fixture.state === 'DISPUTED') {
    return { state: 'Blocked', copy: 'Disputed result — clubs reported different tuples; eligible recovery is organizer review.' };
  }
  if (fixture.state === 'EXPIRED') {
    return { state: 'Blocked', copy: 'Deadline passed — attestation window closed.' };
  }
  const have = [reports?.home?.tuple, reports?.away?.tuple].filter(Boolean).length;
  if (have === 1) {
    const missing = reports?.home?.tuple ? 'away' : 'home';
    return { state: 'Partial', copy: `Waiting for ${missing} referee` };
  }
  return { state: 'Empty', copy: 'Scheduled — awaiting locked strategies and reports.' };
}

export function tuplesMatch(fixture, recomputedTuple) {
  return (
    Number(fixture.homeDelivered) === recomputedTuple.homeDelivered &&
    Number(fixture.homeTurns) === recomputedTuple.homeTurns &&
    Number(fixture.awayDelivered) === recomputedTuple.awayDelivered &&
    Number(fixture.awayTurns) === recomputedTuple.awayTurns
  );
}

export function recomputed(reports) {
  if (!reports?.home?.tuple || !reports?.away?.tuple) return null;
  return reports.home.tuple;
}

// Turn index → which side's frame to draw (both move each turn).
export function pathsAtTurn(frames, upto) {
  const cells = [];
  const parcels = {};
  for (const f of frames.slice(0, upto + 1)) {
    cells.push(f[1]);
    if (f[2] > cells.filter((c) => c === f[1]).length - 1) parcels[f[1]] = f[2];
  }
  return cells;
}

export function deliveriesOf(frame) {
  return frame ? frame[2] : 0;
}

// First-difference summary for the evidence drawer.
export function reportDifference(homeReport, awayReport) {
  if (!homeReport || !awayReport) {
    return { kind: 'MISSING', side: !homeReport ? 'home' : 'away' };
  }
  const hf = homeReport.frames ?? [];
  const af = awayReport.frames ?? [];
  const n = Math.min(hf.length, af.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(hf[i]) !== JSON.stringify(af[i])) {
      return { kind: 'DIFFER', turn: i, home: hf[i], away: af[i] };
    }
  }
  if (hf.length !== af.length) return { kind: 'LENGTH', turn: n };
  return { kind: 'EQUAL' };
}

export function formatState(fixture, reports) {
  return fixtureState(fixture, reports).state;
}
