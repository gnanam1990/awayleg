import { useEffect, useRef, useState } from 'react';
import './desk.css';
import {
  deliveriesOf,
  fixtureState,
  formatState,
  official,
  pathsAtTurn,
  recompute,
  reportDifference,
} from './desk.js';

const API = import.meta.env.VITE_INDEXER_URL
  ?? (location.port === '5173' || location.port === '5174'
    ? 'http://localhost:3000'
    : `${location.origin}/__devin/port/3000`);

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
  const [slots, setSlots] = useState(null);
  const [replay, setReplay] = useState(null); // {homeFrames, awayFrames, recomputed}
  const [course, setCourse] = useState(null);
  const [standings, setStandings] = useState(null);
  const [height, setHeight] = useState(null);
  const [stale, setStale] = useState(false);
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
  const fetchBytes = (p) => fetch(`${API}${p}`).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.arrayBuffer().then((b) => new Uint8Array(b));
  });

  useEffect(() => {
    Promise.all([fetchJson('/api/fixtures'), fetchJson('/api/standings')])
      .then(([f, s]) => {
        setFixtures(f.fixtures);
        setHeight(f.height);
        setStale(!!f.stale);
        setStandings(s);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    setFixture(null); setSlots(null); setReplay(null); setCourse(null);
    fetchJson(`/api/fixtures/${selected}`)
      .then(async (d) => {
        const f = d.fixture;
        setFixture(f);
        setSlots(d.slots);
        setHeight(d.height);
        setStale(!!d.stale);
        setAnnounce(`Fixture ${f.id}: ${fixtureState(f, {}).state}`);
        setTurn(0);
        if (f.courseHash) {
          const bytes = await fetchBytes(`/api/artifacts/${f.courseHash}`).catch(() => null);
          if (bytes) {
            setCourse(JSON.parse(new TextDecoder().decode(bytes)));
            const homeOrder = d.slots?.find((s) => s.role === 'home')?.lockedOrder;
            const awayOrder = d.slots?.find((s) => s.role === 'away')?.lockedOrder;
            if (homeOrder && awayOrder) {
              setReplay(recompute({ courseBytes: bytes, homeOrder, awayOrder }));
            }
          }
        }
      })
      .catch((e) => setError(e.message));
  }, [selected]);

  const st = fixtureState(fixture, replay ? { recomputed: replay.recomputed } : {});
  const homeFrames = replay?.homeFrames ?? [];
  const awayFrames = replay?.awayFrames ?? [];
  const homeTurn = Math.max(homeFrames.length - 1, 0);
  const awayTurn = Math.max(awayFrames.length - 1, 0);
  const maxTurn = Math.max(homeTurn, awayTurn, 0);
  const homePath = pathsAtTurn(homeFrames, Math.min(turn, homeTurn));
  const awayPath = pathsAtTurn(awayFrames, Math.min(turn, awayTurn));
  const diff = reportDifference(fixture?.homeReport, fixture?.awayReport);
  const off = official(fixture);
  const rec = replay?.recomputed;

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
        <p className="finality">
          {height != null && <>finalized height <span className="mono">{height}</span></>}
          {stale && <span className="pill state-Blocked"> stale — recovering</span>}
        </p>
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
                  #{f.id} <span className="mono addr">{f.homeEntrant?.slice(0, 10)}</span> vs <span className="mono addr">{f.awayEntrant?.slice(0, 10)}</span>
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
                  <tr><td>home</td><td>{standings.home ?? 0}</td></tr>
                  <tr><td>away</td><td>{standings.away ?? 0}</td></tr>
                  <tr><td>accepted fixtures</td><td>{standings.accepted ?? 0}</td></tr>
                  <tr><td>distinct holders</td><td>{standings.distinctLockedEntrants ?? 0}</td></tr>
                </tbody>
              </table>
            </section>
          )}
        </nav>

        <main className="board-area" onKeyDown={onKey} tabIndex={0} aria-label="match board — arrows scrub turns">
          {!fixture && selected == null && !error && <p className="loading">Open a match row to inspect both referee receipts.</p>}
          {!fixture && selected != null && !error && <p className="loading">Loading fixture #{selected}…</p>}
          {fixture && (
            <>
              <div className="scoreboard">
                <div className="side home">
                  <span className="club" title={fixture.homeEntrant}>{fixture.homeEntrant?.slice(0, 10)}…</span>
                  <span className="score">{deliveriesOf(homeFrames[homeTurn])}</span>
                  <span className="meta">{homeTurn} turns</span>
                </div>
                <div className={`verdict ${st.state.toLowerCase()}`}>
                  <span className="pill">{st.copy}</span>
                  <span className="turn-label">turn {turn}</span>
                </div>
                <div className="side away">
                  <span className="club" title={fixture.awayEntrant}>{fixture.awayEntrant?.slice(0, 10)}…</span>
                  <span className="score">{deliveriesOf(awayFrames[awayTurn])}</span>
                  <span className="meta">{awayTurn} turns</span>
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
                  const r = side === 'home' ? fixture.homeReport : fixture.awayReport;
                  return (
                    <div key={side} className={`ref-row ${side}`}>
                      <strong>{side} referee</strong>
                      {r ? (
                        <>
                          <code>{String(r.replayHash).slice(0, 18)}…</code>
                          <span>{r.homeDelivered}/{r.homeTurns} — {r.awayDelivered}/{r.awayTurns}</span>
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
              <dt>Chain / fixture</dt>
              <dd><code>31337 · {fixture?.id}</code></dd>
              <dt>Course hash</dt>
              <dd><code>{fixture?.courseHash ?? '—'}</code></dd>
              <dt>Attested summary</dt>
              <dd>{off ? `${off.homeDelivered}/${off.homeTurns} — ${off.awayDelivered}/${off.awayTurns}` : 'pending'}</dd>
              <dt>Recomputed</dt>
              <dd>{rec ? `${rec.homeDelivered}/${rec.homeTurns} — ${rec.awayDelivered}/${rec.awayTurns}` : 'pending'}</dd>
              <dt>Entry / attest close</dt>
              <dd><code>{fixture?.entryClose} / {fixture?.attestClose}</code></dd>
              <dt>First difference</dt>
              <dd>
                {diff.kind === 'DIFFER' && `fields differ: ${diff.fields.join(', ')}`}
                {diff.kind === 'MISSING' && `${diff.side} report missing — retry download`}
                {diff.kind === 'EQUAL' && 'reports identical'}
              </dd>
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}
