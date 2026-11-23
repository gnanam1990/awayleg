import { useEffect, useRef, useState } from 'react';
import './desk.css';
import { deliveriesOf, fixtureState, pathsAtTurn, reportDifference } from './desk.js';

const API = import.meta.env.VITE_INDEXER_URL ?? 'http://localhost:3000';

function Cell({ x, y, course, homePath, awayPath }) {
  const cell = y * 6 + x;
  const isBlocked = course?.blocked?.includes(cell);
  const isStart = course?.start === cell;
  const parcelIdx = course?.parcels?.indexOf(cell);
  const inHome = homePath?.includes(cell);
  const inAway = awayPath?.includes(cell);
  let cls = 'cell';
  if (isBlocked) cls += ' blocked';
  if (isStart) cls += ' start';
  if (parcelIdx >= 0) cls += ` parcel`;
  if (inHome && inAway) cls += ' both-path';
  else if (inHome) cls += ' home-path';
  else if (inAway) cls += ' away-path';
  return (
    <div className={cls} role="gridcell" aria-label={`cell ${cell}${parcelIdx >= 0 ? `, parcel ${parcelIdx + 1}` : ''}`}>
      {parcelIdx >= 0 && <span className="parcel-no">{parcelIdx + 1}</span>}
    </div>
  );
}

export default function App() {
  const [fixtures, setFixtures] = useState(null);
  const [selected, setSelected] = useState(null);
  const [fixture, setFixture] = useState(null);
  const [reports, setReports] = useState({ home: null, away: null });
  const [course, setCourse] = useState(null);
  const [standings, setStandings] = useState(null);
  const [error, setError] = useState(null);
  const [turn, setTurn] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const drawerRef = useRef(null);
  const openerRef = useRef(null);

  const fetchJson = (p) => fetch(`${API}${p}`).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });

  useEffect(() => {
    Promise.all([fetchJson('/api/fixtures'), fetchJson('/api/standings')])
      .then(([f, s]) => { setFixtures(f.fixtures); setStandings(s); setError(null); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    setFixture(null); setReports({ home: null, away: null }); setCourse(null);
    fetchJson(`/api/fixtures/${selected}`)
      .then(async (f) => {
        setFixture(f);
        setAnnounce(`Fixture ${f.id}: ${fixtureState(f, {}).state}`);
        setTurn(0);
        if (f.courseDigest) {
          fetchJson(`/api/artifacts/${f.courseDigest}`).then(setCourse).catch(() => {});
        }
        const [home, away] = await Promise.all([
          fetchJson(`/api/fixtures/${selected}/reports/home`).catch(() => null),
          fetchJson(`/api/fixtures/${selected}/reports/away`).catch(() => null),
        ]);
        setReports({ home, away });
      })
      .catch((e) => setError(e.message));
  }, [selected]);

  const st = fixtureState(fixture, reports);
  const homeFrames = fixture?.homeFrames ?? reports?.home?.homeFrames ?? [];
  const awayFrames = fixture?.awayFrames ?? reports?.home?.awayFrames ?? [];
  const maxTurn = Math.max(homeFrames.length - 1, awayFrames.length - 1, 0);
  const homePath = pathsAtTurn(homeFrames, turn);
  const awayPath = pathsAtTurn(awayFrames, turn);
  const diff = reportDifference(reports.home, reports.away);

  const onKey = (e) => {
    if (e.key === 'ArrowRight') setTurn((t) => Math.min(t + 1, maxTurn));
    if (e.key === 'ArrowLeft') setTurn((t) => Math.max(t - 1, 0));
    if (e.key === 'Home') setTurn(0);
    if (e.key === 'End') setTurn(maxTurn);
  };

  const openDrawer = (e) => {
    openerRef.current = e.currentTarget;
    setDrawerOpen(true);
    requestAnimationFrame(() => drawerRef.current?.focus());
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <div className="desk">
      <header className="masthead">
        <h1>AwayLeg Match Desk</h1>
        <p className="standby" aria-live="polite">{announce}</p>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>Error — {error}. Prior finalized state remains shown; reads retry safely.</span>
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      <div className="layout">
        <nav className="fixture-list" aria-label="fixtures">
          <h2>Fixtures</h2>
          {fixtures === null && <p className="loading">Loading fixtures…</p>}
          {fixtures?.length === 0 && <p className="empty">No fixtures yet — organizer uploads the canonical course to schedule the first duel.</p>}
          <ul>
            {fixtures?.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => setSelected(f.id)}
                  aria-current={selected === f.id}
                  className={selected === f.id ? 'active' : ''}
                >
                  #{f.id} {f.homeClub ?? f.homeEntrant} vs {f.awayClub ?? f.awayEntrant}
                  <span className={`pill state-${formatState(f, {})}`}>{formatState(f, {})}</span>
                </button>
              </li>
            ))}
          </ul>
          {standings && (
            <section aria-label="standings">
              <h2>Standings</h2>
              <table className="standings">
                <tbody>
                  {standings.rows?.map((r) => (
                    <tr key={r.club}><td>{r.club}</td><td>{r.points}</td></tr>
                  ))}
                  {(!standings.rows || standings.rows.length === 0) && (
                    <tr><td>Accepted fixtures</td><td>0</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}
        </nav>

        <main className="board-area" onKeyDown={onKey} tabIndex={0} aria-label="match board — arrows scrub turns">
          {!fixture && selected == null && <p className="loading">Open a match row to inspect both referee receipts.</p>}
          {!fixture && selected != null && !error && <p className="loading">Loading fixture #{selected}…</p>}
          {fixture && (
            <>
              <div className="scoreboard">
                <div className="side home">
                  <span className="club">{fixture.homeClub ?? fixture.homeEntrant}</span>
                  <span className="score">{deliveriesOf(homeFrames[maxTurn])}</span>
                  <span className="meta">{homeFrames[maxTurn]?.[0] ?? 0} turns</span>
                </div>
                <div className={`verdict ${st.state.toLowerCase()}`}>
                  <span className="pill">{st.copy}</span>
                  <span className="turn-label">turn {turn}</span>
                </div>
                <div className="side away">
                  <span className="club">{fixture.awayClub ?? fixture.awayEntrant}</span>
                  <span className="score">{deliveriesOf(awayFrames[maxTurn])}</span>
                  <span className="meta">{awayFrames[maxTurn]?.[0] ?? 0} turns</span>
                </div>
              </div>
              {st.integrity === 'warn' && <p className="banner warn" role="alert">{st.integrityCopy}</p>}

              <div className="board" role="grid" aria-label="6 by 6 courier board">
                {Array.from({ length: 36 }, (_, i) => (
                  <Cell key={i} x={i % 6} y={Math.floor(i / 6)} course={course} homePath={homePath} awayPath={awayPath} />
                ))}
              </div>

              <div className="controls">
                <button onClick={() => setTurn(0)} aria-label="first turn">⏮</button>
                <button onClick={() => setTurn((t) => Math.max(t - 1, 0))} aria-label="previous turn">◀</button>
                <input
                  type="range" min={0} max={maxTurn} value={turn}
                  onChange={(e) => setTurn(Number(e.target.value))}
                  aria-label="scrub to turn"
                />
                <button onClick={() => setTurn((t) => Math.min(t + 1, maxTurn))} aria-label="next turn">▶</button>
                <button onClick={() => setTurn(maxTurn)} aria-label="last turn">⏭</button>
              </div>

              <section className="referee-rows" aria-label="referee reports">
                <h2>Referee reports</h2>
                {['home', 'away'].map((side) => {
                  const r = reports[side];
                  return (
                    <div key={side} className={`ref-row ${side}`}>
                      <strong>{side} referee</strong>
                      {r ? (
                        <>
                          <code>{r.replayHash?.slice(0, 18)}…</code>
                          <span>{r.tuple?.homeDelivered}/{r.tuple?.homeTurns} — {r.tuple?.awayDelivered}/{r.tuple?.awayTurns}</span>
                          <a href={r.txHash ? `#${r.txHash}` : undefined}>{r.txHash ? 'receipt' : 'local'}</a>
                        </>
                      ) : (
                        <span>Missing report — <button onClick={() => setSelected(selected)}>retry download</button></span>
                      )}
                    </div>
                  );
                })}
                <button className="evidence-open" onClick={openDrawer}>Evidence drawer</button>
              </section>

              <details className="sr-frames">
                <summary>Frame-by-frame table</summary>
                <table>
                  <thead><tr><th>turn</th><th>home cell</th><th>home delivered</th><th>away cell</th><th>away delivered</th></tr></thead>
                  <tbody>
                    {Array.from({ length: maxTurn + 1 }, (_, t) => (
                      <tr key={t}>
                        <td>{t}</td>
                        <td>{homeFrames[t]?.[1] ?? '—'}</td>
                        <td>{homeFrames[t]?.[2] ?? '—'}</td>
                        <td>{awayFrames[t]?.[1] ?? '—'}</td>
                        <td>{awayFrames[t]?.[2] ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </main>

        {drawerOpen && (
          <aside className="drawer" role="dialog" aria-label="evidence drawer" ref={drawerRef} tabIndex={-1}>
            <button className="close" onClick={closeDrawer} aria-label="close evidence drawer">×</button>
            <h2>Evidence</h2>
            <dl>
              <dt>Chain / contract / fixture</dt>
              <dd><code>{fixture?.chainId ?? '—'} · {fixture?.contract ?? '—'} · {fixture?.id}</code></dd>
              <dt>Course hash</dt>
              <dd><code>{fixture?.courseHash ?? '—'}</code></dd>
              <dt>Attested summary</dt>
              <dd>{fixture?.homeDelivered ?? '—'}/{fixture?.homeTurns ?? '—'} — {fixture?.awayDelivered ?? '—'}/{fixture?.awayTurns ?? '—'}</dd>
              <dt>Recomputed</dt>
              <dd>{reports.home?.tuple ? `${reports.home.tuple.homeDelivered}/${reports.home.tuple.homeTurns} — ${reports.home.tuple.awayDelivered}/${reports.home.tuple.awayTurns}` : 'pending'}</dd>
              <dt>First difference</dt>
              <dd>
                {diff.kind === 'DIFFER' && `turn ${diff.turn}: ${JSON.stringify(diff.home)} vs ${JSON.stringify(diff.away)}`}
                {diff.kind === 'LENGTH' && `traces diverge at turn ${diff.turn} (length)`}
                {diff.kind === 'MISSING' && `${diff.side} trace missing — retry download`}
                {diff.kind === 'EQUAL' && 'reports identical'}
              </dd>
            </dl>
            <button onClick={() => window.alert('bundle export requires the referee CLI — replay bytes stay digest-addressed')} >Export evidence bundle</button>
          </aside>
        )}
      </div>
    </div>
  );
}
