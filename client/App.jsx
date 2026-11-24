import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import { overallProgress, mergeLogs } from '../shared/progress.js';
import { detectIndustry, rankCaseStudies, companyWide } from '../shared/caseStudies.js';
import { StackPage, AppendixPage } from './Docs.jsx';
import { buildSignals } from '../shared/signals.js';

/* ------------------------------- constants -------------------------------- */

const WEDGE = ['cmo', 'director_social', 'chief_digital', 'director_cx'];
const PERSONA_TEXT = {
  cmo: 'CMO', director_social: 'Director of Social', chief_digital: 'Chief Digital Officer',
  director_cx: 'Director of CX', team_social: 'Social / community team',
};
const LABEL_TEXT = { verified: 'Verified', single_source: 'Single source', inferred: 'Inferred', vendor_claim: 'Vendor claim', unverified: 'Unverified' };
const STEPS = [
  ['resolve', 'Find brand and accounts'],
  ['profile', 'Brand profile'],
  ['stakeholders', 'Stakeholders'],
  ['social', 'Social pages'],
];
const PLATFORMS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['x', 'X'], ['linkedin', 'LinkedIn']];
const ACCOUNT_TABS = [['overview', 'Overview'], ['people', 'People'], ['plan', 'Plan'], ['receipts', 'Receipts']];

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const compact = (n) => (n === null || n === undefined ? '—' : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const months = (m) => (m === null || m === undefined ? '—' : m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`);
const secs = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 1000) : null);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const hostname = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };
const safeStore = {
  get(k) { try { return window.localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* --------------------------------- router --------------------------------- */

function currentRoute() {
  // Old ?brand= links from the first version still work.
  const legacy = new URLSearchParams(window.location.search).get('brand');
  if (legacy) return { page: 'account', slug: legacy };
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'accounts' && parts[1]) return { page: 'account', slug: decodeURIComponent(parts[1]), tab: ACCOUNT_TABS.some(([k]) => k === parts[2]) ? parts[2] : 'overview' };
  if (parts[0] === 'accounts') return { page: 'accounts' };
  if (parts[0] === 'spend') return { page: 'spend' };
  if (parts[0] === 'playbook') return { page: 'playbook' };
  if (parts[0] === 'stack') return { page: 'stack' };
  if (parts[0] === 'appendix') return { page: 'appendix' };
  return { page: 'search' };
}
function pathFor(r) {
  if (r.page === 'account') return `/accounts/${encodeURIComponent(r.slug)}${r.tab && r.tab !== 'overview' ? `/${r.tab}` : ''}`;
  if (r.page === 'accounts') return '/accounts';
  if (r.page === 'spend') return '/spend';
  if (r.page === 'playbook') return '/playbook';
  if (r.page === 'stack') return '/stack';
  if (r.page === 'appendix') return '/appendix';
  return '/';
}

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const go = useCallback((r) => {
    window.history.pushState({}, '', pathFor(r));
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('brand')) window.history.replaceState({}, '', pathFor(route));
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const live = useActiveRun();
  const tab = route.page === 'account' ? 'accounts' : route.page;
  return (
    <div className="shell">
      <Sidebar tab={tab} go={go} live={live} />
      <main className="content">
        {route.page === 'search' && <SearchPage go={go} live={live} />}
        {route.page === 'accounts' && <AccountsPage go={go} live={live} />}
        {route.page === 'account' && <AccountPage slug={route.slug} tab={route.tab || 'overview'} go={go} live={live} />}
        {route.page === 'spend' && <SpendPage go={go} live={live} />}
        {route.page === 'playbook' && <PlaybookPage />}
        {route.page === 'stack' && <StackPage />}
        {route.page === 'appendix' && <AppendixPage />}
      </main>
    </div>
  );
}

function Sidebar({ tab, go, live }) {
  const items = [['search', 'Search', IconSearch], ['accounts', 'Accounts', IconList], ['playbook', 'Playbook', IconBook], ['spend', 'Spend', IconCoins], ['stack', 'Stack Decisions', IconLayers], ['appendix', 'Appendix: What I Cut', IconScissors]];
  return (
    <aside className="sidebar">
      <a className="brandmark" href="/" onClick={(e) => { e.preventDefault(); go({ page: 'search' }); }}>
        <img src="/nectar-logo-on-dark.svg" alt="Nectar" width="97" height="23" />
        <span className="tool">Brand Entry Tool</span>
      </a>
      <nav>
        {items.map(([key, label, Icon]) => (
          <a key={key} href={pathFor({ page: key })} className={tab === key ? 'on' : ''}
            onClick={(e) => { e.preventDefault(); go({ page: key }); }}>
            <Icon /> <span>{label}</span>
          </a>
        ))}
      </nav>
      <RunBadge live={live} go={go} tab={tab} />
      <p className="byline">Prototype by Ben Sollitt. Recommends only; never acts on LinkedIn.</p>
    </aside>
  );
}

/* ------------------------------- active run -------------------------------- */

/* The run lives on the server; this only remembers which run this browser started so
   the bar and log survive switching tabs, refreshing or closing the tab. Polling happens
   here, above the pages, so no page change can interrupt it. */
const RUN_KEY = 'activeRun';
const FINISHED = ['done', 'partial', 'failed'];
const STALE_MS = 30 * 60 * 1000;

function useActiveRun() {
  const [active, setActive] = useState(() => { try { return JSON.parse(safeStore.get(RUN_KEY) || 'null'); } catch { return null; } });
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');

  const start = useCallback((id, input) => {
    const a = { id, input, at: new Date().toISOString() };
    safeStore.set(RUN_KEY, JSON.stringify(a));
    setRun(null); setErr(''); setActive(a);
  }, []);
  const clear = useCallback(() => { safeStore.set(RUN_KEY, ''); setActive(null); setRun(null); setErr(''); }, []);

  useEffect(() => {
    if (!active) return undefined;
    let stop = false; let timer = null; let misses = 0;
    async function tick() {
      try {
        const r = await api.run(active.id);
        if (stop) return;
        misses = 0; setErr(''); setRun(r);
        const finished = FINISHED.includes(r.status);
        // A run finished long ago (e.g. reopened tomorrow) is history, not "active".
        if (finished && r.finished_at && Date.now() - new Date(r.finished_at) > STALE_MS) { clear(); return; }
        if (!finished) timer = setTimeout(tick, 1500);
      } catch (ex) {
        if (stop) return;
        if (ex.status === 404 || ex.status === 400) { clear(); return; }
        // Network blip or deploy: keep the run, keep trying, say so after a few misses.
        misses += 1;
        if (misses >= 3) setErr('Lost connection to the server, retrying…');
        timer = setTimeout(tick, Math.min(10000, 1500 * misses));
      }
    }
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [active?.id]);

  const finished = run ? FINISHED.includes(run.status) : false;
  return { active, run, err, finished, start, clear };
}

/* Elapsed seconds since the run started, ticking once a second while it runs. */
function useElapsed(run) {
  const [now, setNow] = useState(Date.now());
  const running = run && !FINISHED.includes(run.status);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!run?.started_at) return 0;
  const end = run.finished_at ? new Date(run.finished_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(run.started_at).getTime()) / 1000));
}
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* --------------------------------- search --------------------------------- */

function SearchPage({ go, live }) {
  const [input, setInput] = useState('');
  const [code, setCode] = useState(safeStore.get('accessCode'));
  const [showCode, setShowCode] = useState(!safeStore.get('accessCode'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      safeStore.set('accessCode', code);
      const r = await api.startRun(input, code);
      live.start(r.runId, input.trim());
    } catch (ex) {
      setErr(ex.message);
      if (ex.status === 401) setShowCode(true);
    } finally { setBusy(false); }
  }

  return (
    <section className="center">
      <div className={`hero${live.active ? ' wide' : ''}`}>
        <h1>Research a brand</h1>
        <p className="lede">Brand profile, wedge personas, social pages and receipts for every claim.</p>
        {!live.active ? (
          <form onSubmit={submit} className="search">
            <div className="searchbar">
              <IconSearch />
              <input value={input} onChange={(e) => setInput(e.target.value)} autoFocus
                placeholder="Brand name or LinkedIn company URL" aria-label="Brand name or LinkedIn company URL" maxLength={200} required />
              <button type="submit" className="pill" disabled={busy || !input.trim()}>{busy ? 'Starting…' : 'Research'}</button>
            </div>
            {showCode ? (
              <input className="code" value={code} onChange={(e) => setCode(e.target.value)} type="password" autoComplete="off"
                placeholder="Access code" aria-label="Access code" />
            ) : (
              <button type="button" className="link" onClick={() => setShowCode(true)}>Change access code</button>
            )}
            {err && <p className="error">{err}</p>}
            <p className="hint">Live runs take 1 to 3 minutes and need an access code. You can switch tabs while one runs. Past research is open to everyone under <a href="/accounts" onClick={(e) => { e.preventDefault(); go({ page: 'accounts' }); }}>Accounts</a>.</p>
          </form>
        ) : (
          <RunConsole live={live} go={go} />
        )}
      </div>
    </section>
  );
}

const MODULE_TAG = { resolve: 'find', profile: 'profile', stakeholders: 'people', social: 'social' };

function RunConsole({ live, go }) {
  const { active, run, err, finished, clear } = live;
  const elapsed = useElapsed(run);
  const pct = Math.round(overallProgress(run) * 100);
  const lines = mergeLogs(run?.modules || []);
  const startedAt = run?.started_at ? new Date(run.started_at).getTime() : null;
  const box = React.useRef(null);
  const pinned = React.useRef(true);
  const sawRunning = React.useRef(false);

  // Follow new lines unless the reader scrolled up to look at something.
  React.useLayoutEffect(() => { if (box.current && pinned.current) box.current.scrollTop = box.current.scrollHeight; }, [lines.length]);
  const onScroll = () => { const b = box.current; if (b) pinned.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24; };

  // Open the account automatically only if the run finished while this page was open.
  useEffect(() => {
    if (run && !finished) sawRunning.current = true;
    if (finished && sawRunning.current && run.status !== 'failed' && run.brand?.slug) {
      const t = setTimeout(() => { clear(); go({ page: 'account', slug: run.brand.slug }); }, 1400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [finished, run?.status]);

  const current = (run?.modules || []).filter((m) => m.status === 'running').map((m) => STEPS.find(([k]) => k === m.module)?.[1]);
  const status = !run ? 'Starting…'
    : run.status === 'failed' ? 'Run failed'
      : finished ? (run.status === 'partial' ? 'Finished with gaps' : 'Finished')
        : current.length ? current.join(' · ') : 'Working…';

  return (
    <div className={`console-wrap${run?.status === 'failed' ? ' is-failed' : finished ? ' is-done' : ''}`}>
      <div className="console-head">
        <p className="progress-title">{run?.status === 'failed' ? 'Could not research' : finished ? 'Researched' : 'Researching'} <strong>{run?.brand?.name || active.input}</strong></p>
        <span className="elapsed" aria-label="Elapsed time">{clock(elapsed)}</span>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Run progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-row"><span>{status}</span><strong>{pct}%</strong></div>

      <ol className="chips">
        {STEPS.map(([key, label]) => {
          const st = (run?.modules || []).find((m) => m.module === key)?.status || 'queued';
          return <li key={key} className={`chip st-${st}`}><span className="dot">{st === 'done' ? <IconCheck /> : st === 'failed' || st === 'skipped' ? '!' : ''}</span>{label}</li>;
        })}
      </ol>

      <div className="console" ref={box} onScroll={onScroll} role="log" aria-live="polite" aria-label="Run log">
        {lines.length === 0 && <div className="line muted">Waiting for the server…</div>}
        {lines.map((l, i) => (
          <div key={i} className={`line${/failed|Couldn't|Stopped|Gaps:|no account found/i.test(l.text) ? ' warn' : ''}`}>
            <span className="t">{l.at && startedAt ? clock(Math.max(0, Math.round((new Date(l.at) - startedAt) / 1000))) : (l.clock || '')}</span>
            <span className={`tag m-${l.module}`}>{MODULE_TAG[l.module] || l.module}</span>
            <span className="msg">{l.text}</span>
          </div>
        ))}
        {run && !finished && <div className="line cursor"><span className="t" /><span className="tag" /><span className="msg">▍</span></div>}
      </div>

      {err && <p className="error">{err}</p>}
      {run?.status === 'failed' && lines.length === 0 && <p className="error">{run.error || 'The run failed.'}</p>}
      {finished && (
        <div className="console-actions">
          {run.status !== 'failed' && run.brand?.slug && (
            <button className="pill" onClick={() => { clear(); go({ page: 'account', slug: run.brand.slug }); }}>Open {run.brand.name}</button>
          )}
          <button className="pill ghost" onClick={clear}>Research another brand</button>
        </div>
      )}
    </div>
  );
}

/* Small status card in the sidebar, visible from every tab while a run is active. */
function RunBadge({ live, go, tab }) {
  const { active, run, finished, clear } = live;
  if (!active) return null;
  const pct = Math.round(overallProgress(run) * 100);
  const name = run?.brand?.name || active.input;
  const failed = run?.status === 'failed';
  const open = (e) => {
    e.preventDefault();
    if (finished && !failed && run.brand?.slug) { clear(); go({ page: 'account', slug: run.brand.slug }); } else go({ page: 'search' });
  };
  if (tab === 'search') return null; // the full console and its buttons are already on screen
  return (
    <a href="/" className={`runbadge${failed ? ' failed' : finished ? ' done' : ''}`} onClick={open}>
      <span className="rb-title">{failed ? 'Run failed' : finished ? 'Research ready' : 'Researching'}</span>
      <span className="rb-name">{name}</span>
      {!finished && <span className="rb-bar"><i style={{ width: `${pct}%` }} /></span>}
      <span className="rb-cta">{failed ? 'See what happened' : finished ? 'Open account →' : `${pct}% · view log`}</span>
    </a>
  );
}

/* Loads page data, reloads when this browser's run finishes, and re-checks every few
   seconds while the data says something is still running (e.g. a run started elsewhere). */
function useLiveData(load, deps, stillRunning) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false; let timer = null;
    const fetchIt = (first) => load().then((d) => {
      if (stop) return;
      setData(d); setErr('');
      if (stillRunning(d)) timer = setTimeout(() => fetchIt(false), 8000);
    }).catch((ex) => { if (!stop && first) setErr(ex.message); else if (!stop) timer = setTimeout(() => fetchIt(false), 8000); });
    fetchIt(true);
    return () => { stop = true; clearTimeout(timer); };
  }, deps);
  return { data, err, setData };
}

/* -------------------------------- accounts -------------------------------- */

function AccountsPage({ go, live }) {
  const { data: rows, err } = useLiveData(() => api.brands(), [live.finished], (d) => d.some((b) => b.running));
  return (
    <section className="page">
      <header className="page-head"><h1>Accounts</h1><p className="muted">Every brand researched so far.</p></header>
      {err && <p className="error">{err}</p>}
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">Nothing researched yet.</p> : (
        <div className="card flush">
          <table className="list">
            <thead><tr><th>Brand</th><th>Owner</th><th className="num">Wedge personas</th><th className="num">People</th><th>Last researched</th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.slug} className="clickable" onClick={() => go({ page: 'account', slug: b.slug })}>
                  <td><strong>{b.name}</strong>{b.running && <span className="running-pill">Researching…</span>}<div className="muted small">{b.domain || ''}</div></td>
                  <td>{b.owner || <span className="muted">—</span>}</td>
                  <td className="num">{b.wedge_count ? <span className="wedge-count">{b.wedge_count}</span> : <span className="muted">0</span>}</td>
                  <td className="num">{b.people_count}</td>
                  <td>{day(b.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AccountPage({ slug, tab, go, live }) {
  const [kick, setKick] = useState(0); // bumped after starting a draft so polling restarts
  const { data: b, err } = useLiveData(() => api.brand(slug), [slug, live.finished, kick],
    (d) => ['running', 'queued'].includes(d?.lastRun?.status) || d?.draft?.status === 'running');
  const [picking, setPicking] = useState(false);
  const [selected, setSelected] = useState([]);
  useEffect(() => { setPicking(false); setSelected([]); }, [slug]);
  if (err) return <section className="page"><p className="error">{err}</p></section>;
  if (!b || b.brand?.slug !== slug) return <section className="page"><p className="muted">Loading…</p></section>;

  const { brand, profile, stakeholders, social, lastRun } = b;
  const facts = profile?.facts || [];
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));
  const wedge = stakeholders.filter((s) => WEDGE.includes(s.persona)).sort((a, c) => WEDGE.indexOf(a.persona) - WEDGE.indexOf(c.persona));
  const team = stakeholders.filter((s) => !WEDGE.includes(s.persona));
  const gaps = brand.gaps || [];
  const setTab = (t) => go({ page: 'account', slug, tab: t });

  // The numbers strip: the account at a glance, each one opens the tab it comes from.
  const counted = social.filter((a) => a.followers !== null && a.followers !== undefined);
  const followers = counted.reduce((n, a) => n + Number(a.followers), 0);
  const recentPosts = allPosts(b).filter((p) => within90(p.posted_at)).length;
  const d = b.draft;
  const flags = d?.status === 'done' ? (d.output?.problems || []).length : 0;
  const planText = d?.status === 'running' ? 'Drafting…' : d?.status === 'failed' ? 'Draft failed' : d?.status === 'done' ? (flags ? `Ready · ${flags} to check` : 'Ready') : 'Not drafted';
  const strip = [
    { tab: 'overview', value: counted.length ? compact(followers) : '—', label: 'followers' },
    { tab: 'overview', value: counted.length, label: counted.length ? PLATFORMS.filter(([k]) => counted.some((a) => a.platform === k)).map(([, l]) => l).join(', ') : 'platforms' },
    { tab: 'people', value: stakeholders.length, label: `people · ${wedge.length}/${WEDGE.length} wedge roles` },
    { tab: 'people', value: recentPosts, label: 'posts, last 3 months' },
    { tab: 'plan', value: planText, label: 'engagement plan', state: d?.status === 'done' ? (flags ? 'warn' : 'ok') : d?.status === 'failed' ? 'bad' : '' },
  ];
  const badge = { people: stakeholders.length, plan: d?.status === 'done' ? (flags ? '!' : '✓') : d?.status === 'running' ? '…' : '', receipts: facts.length };

  // Choosing posts happens in the Plan tab, with the feed right under the redraft buttons.
  const picker = (
    <LinkedInActivity b={b} picking={picking} selected={selected}
      onToggle={(url) => setSelected((cur) => (cur.includes(url) ? cur.filter((u) => u !== url) : cur.length >= 3 ? cur : [...cur, url]))} />
  );

  return (
    <section className="page">
      <button className="back" onClick={() => go({ page: 'accounts' })}>← Accounts</button>
      <header className="page-head">
        <h1>{brand.name}</h1>
        <p className="muted">
          {brand.domain && <a href={`https://${brand.domain}`} target="_blank" rel="noreferrer">{brand.domain}</a>}
          {lastRun?.finished_at && <> · researched {day(lastRun.finished_at)}</>}
        </p>
        {profile && <OwnershipLine own={profile.ownership} reporting={profile.reporting} factById={factById} />}
      </header>

      <div className="strip">
        {strip.map((x, i) => (
          <button key={i} className={`stripcell${x.state ? ` is-${x.state}` : ''}`} onClick={() => setTab(x.tab)}>
            <strong>{x.value}</strong><span title={x.label}>{x.label}</span>
          </button>
        ))}
      </div>

      {['running', 'queued'].includes(lastRun?.status) && (
        <div className="banner">
          <span className="spinner" aria-hidden="true" />
          <span>New research is running for {brand.name}. This page updates when it finishes{!profile ? '; until then some sections are empty' : ', and shows the previous results until then'}.</span>
          {live.active?.id === lastRun.id && <button className="link" onClick={() => go({ page: 'search' })}>View log</button>}
        </div>
      )}

      <nav className="tabs" role="tablist" aria-label="Account sections">
        {ACCOUNT_TABS.map(([k, label]) => (
          <a key={k} role="tab" aria-selected={tab === k} className={`tabbtn${tab === k ? ' on' : ''}`} href={pathFor({ page: 'account', slug, tab: k })}
            onClick={(e) => { e.preventDefault(); setTab(k); }}>
            {label}{badge[k] !== undefined && badge[k] !== '' && <span className="tabcount">{badge[k]}</span>}
          </a>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <Signals b={b} />
          {profile && (profile.summary || []).length > 0 && (
            <div className="card">
              <h2>Summary</h2>
              <Summary points={profile.summary} factById={factById} />
            </div>
          )}
          <div className="card">
            <h2>Social pages</h2>
            <div className="socials">
              {PLATFORMS.map(([key, label]) => {
                const a = social.find((x) => x.platform === key);
                return (
                  <div key={key} className="social">
                    <div className="social-head">
                      <span>{label}</span>
                      {a?.url && <a href={a.url} target="_blank" rel="noreferrer">@{a.handle}</a>}
                    </div>
                    <div className="stat"><strong>{compact(a?.followers)}</strong><span>followers</span></div>
                    <div className="sub">
                      {key === 'linkedin'
                        ? <span>{a?.extra?.employees ? `${fmt(a.extra.employees)} employees` : ''}</span>
                        : <span>{fmt(a?.following)} following</span>}
                      {key !== 'linkedin' && <span>{a?.post_count === null || a?.post_count === undefined ? '— posts' : `${fmt(a.post_count)} posts`}</span>}
                    </div>
                    {(a?.error || a?.extra?.restricted) && (
                      <p className="note">{a.error || 'Age-restricted account: posts are not visible to public scrapers.'}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <CaseStudies b={b} go={go} />
        </>
      )}

      {tab === 'people' && (
        <>
          <div className="card">
            <h2>Stakeholders</h2>
            <div className="scroll">
              <table className="people">
                <thead><tr><th>Name</th><th>Title</th><th>Persona</th><th>Tenure</th><th>LinkedIn activity</th></tr></thead>
                <tbody>
                  {wedge.map((s) => <PersonRow key={s.id} s={s} wedge />)}
                  {gaps.map((g) => (
                    <tr key={g.persona} className="gap">
                      <td colSpan={3}>No {PERSONA_TEXT[g.persona]} found</td>
                      <td colSpan={2} className="muted small">Not in Apollo or Prospeo</td>
                    </tr>
                  ))}
                  {team.length > 0 && <tr className="divider"><td colSpan={5}>Social and community team</td></tr>}
                  {team.map((s) => <PersonRow key={s.id} s={s} />)}
                </tbody>
              </table>
            </div>
          </div>
          {!picking && picker}
        </>
      )}

      {tab === 'plan' && (
        <>
          <EngagementPlan b={b} slug={slug} go={go} picking={picking} selected={selected}
            startPicking={() => { setSelected((b.draft?.picks || b.draft?.output?.picks || []).map((p) => p.url)); setPicking(true); window.scrollTo(0, 0); }}
            stopPicking={() => setPicking(false)}
            onStarted={() => { setPicking(false); setKick((k) => k + 1); }} />
          {picking && picker}
        </>
      )}

      {tab === 'receipts' && (
        profile ? (
          <div className="card receipts">
            <div className="card-head">
              <h2>Facts and receipts</h2>
              <span className="muted small">{facts.length} facts{(profile.conflicts || []).length ? `, ${profile.conflicts.length} disagreements` : ''}</span>
            </div>
            <p className="muted small">Each fact quotes the page it came from. Claims without a matching quote are dropped, not shown as facts.</p>
            <ol className="facts">
              {facts.map((f) => (
                <li key={f.id} id={`fact-${f.id}`}>
                  <span className="fid">{f.id}</span> {f.claim} <Label value={f.label} />
                  <blockquote>“{f.quote}” <a href={f.url} target="_blank" rel="noreferrer">{hostname(f.url)}</a>{f.date ? ` · ${f.date}` : ''}</blockquote>
                </li>
              ))}
            </ol>
            {(profile.conflicts || []).length > 0 && (
              <>
                <h3>Sources disagree</h3>
                <ul className="conflicts">
                  {profile.conflicts.map((c, i) => (
                    <li key={i}><strong>{c.topic}.</strong> {c.sources.map((s, j) => <span key={j}>{j ? ' vs ' : ''}<a href={s.url} target="_blank" rel="noreferrer">{hostname(s.url)}</a>: “{s.says}”</span>)}. <em>{c.resolution}</em></li>
                  ))}
                </ul>
              </>
            )}
            {(profile.rejected || []).length > 0 && (
              <>
                <h3>Dropped for missing receipts</h3>
                <ul>{profile.rejected.map((r, i) => <li key={i}>{r.claim} <span className="muted">({r.reason})</span></li>)}</ul>
              </>
            )}
          </div>
        ) : <div className="card"><p className="muted">No brand profile yet.</p></div>
      )}
    </section>
  );
}

/* ----------------------------- LinkedIn activity ---------------------------- */

const DAY = 864e5;
const within90 = (iso) => Boolean(iso) && Date.now() - new Date(iso) < 90 * DAY && new Date(iso) <= new Date();
const ago = (iso) => {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso)) / DAY);
  if (d < 1) return 'today';
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  if (d < 730) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};

/* Same merge as the server: person posts + brand page posts, one copy per URL (a
   team member's repost of a brand post counts as the team copy). */
function allPosts(b) {
  const out = [];
  for (const s of b.stakeholders || []) {
    for (const p of s.stakeholder_posts || []) {
      out.push({ url: p.url, posted_at: p.posted_at, text: p.text || '', is_repost: p.is_repost, reactions: p.reactions, comments: p.comments,
        source: WEDGE.includes(s.persona) ? 'wedge' : 'team', author: s.full_name, persona: s.persona });
    }
  }
  for (const p of b.brandPosts || []) {
    out.push({ url: p.url, posted_at: p.posted_at, text: p.caption || '', is_repost: p.is_repost, reactions: p.likes, comments: p.comments,
      source: 'brand', author: `${b.brand.name} page`, persona: null });
  }
  const byUrl = new Map();
  const w = { wedge: 3, team: 2, brand: 1 };
  for (const p of out) { const prev = byUrl.get(p.url); if (!prev || w[p.source] > w[prev.source]) byUrl.set(p.url, p); }
  return [...byUrl.values()].sort((a, c) => String(c.posted_at || '').localeCompare(String(a.posted_at || '')));
}

const SOURCE_TEXT = { wedge: 'Wedge persona', team: 'Team', brand: 'Brand page' };

function LinkedInActivity({ b, picking, selected, onToggle }) {
  const [filter, setFilter] = useState('90');
  const [limit, setLimit] = useState(12);
  const posts = allPosts(b);
  // Counts per author over the last 3 months, including people with none.
  const authors = [
    { key: 'brand', name: `${b.brand.name} page`, source: 'brand' },
    ...b.stakeholders.map((s) => ({ key: s.id, name: s.full_name, source: WEDGE.includes(s.persona) ? 'wedge' : 'team', persona: s.persona })),
  ].map((a) => ({ ...a, count: posts.filter((p) => (a.source === 'brand' ? p.source === 'brand' : p.author === a.name) && within90(p.posted_at)).length }))
    .sort((a, c) => (c.source === 'wedge') - (a.source === 'wedge') || c.count - a.count);
  const shown = posts.filter((p) => (filter === 'all' ? true : filter === '90' ? within90(p.posted_at) : p.source === filter && within90(p.posted_at)));
  const pulled = b.brandPosts?.length || b.stakeholders.some((s) => (s.stakeholder_posts || []).length);

  return (
    <div className="card">
      <div className="card-head">
        <h2>LinkedIn activity</h2>
        <span className="muted small">{posts.filter((p) => within90(p.posted_at)).length} posts in the last 3 months</span>
      </div>
      {!pulled ? (
        <p className="muted">No LinkedIn posts pulled yet. A new research run pulls posts for every stakeholder and the brand page.</p>
      ) : (
        <>
          <div className="authors">
            {authors.map((a) => (
              <div key={a.key} className={`author${a.source === 'wedge' ? ' is-wedge' : ''}${a.count === 0 ? ' is-quiet' : ''}`}>
                <strong>{a.count}</strong>
                <span className="author-name">{a.name}</span>
                <span className="author-kind">{a.source === 'wedge' ? `Wedge · ${PERSONA_TEXT[a.persona]}` : SOURCE_TEXT[a.source]}</span>
              </div>
            ))}
          </div>
          <div className="filters" role="tablist" aria-label="Filter posts">
            {[['90', 'Last 3 months'], ['wedge', 'Wedge'], ['team', 'Team'], ['brand', 'Brand page'], ['all', 'All time']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={`chipbtn${filter === k ? ' on' : ''}`} onClick={() => { setFilter(k); setLimit(12); }}>{label}</button>
            ))}
          </div>
          {picking && <p className="muted small">Posts older than 3 months are under All time.</p>}
          {shown.length === 0 ? <p className="muted small">No posts for this filter.</p> : (
            <ul className="feed">
              {shown.slice(0, limit).map((p) => {
                const on = selected.includes(p.url);
                const canPick = picking && p.text.trim().length >= 40 && Boolean(p.posted_at) && Date.now() - new Date(p.posted_at) < 365 * DAY;
                return (
                  <li key={p.url} className={`post s-${p.source}${on && picking ? ' picked' : ''}`}>
                    <div className="post-meta">
                      <span className="when">{ago(p.posted_at)}</span>
                      <span className="who">{p.author}</span>
                      <span className={`kind k-${p.source}`}>{SOURCE_TEXT[p.source]}</span>
                      {p.is_repost && <span className="kind">Repost</span>}
                      <span className="eng">{p.reactions ?? '—'} reactions · {p.comments ?? '—'} comments</span>
                      <a href={p.url} target="_blank" rel="noreferrer">Open</a>
                      {canPick && (
                        <label className="pick"><input type="checkbox" checked={on} disabled={!on && selected.length >= 3} onChange={() => onToggle(p.url)} /> Engage</label>
                      )}
                    </div>
                    <Excerpt text={p.text} />
                  </li>
                );
              })}
            </ul>
          )}
          {shown.length > limit && <button className="link more" onClick={() => setLimit(limit + 20)}>Show {Math.min(20, shown.length - limit)} more</button>}
        </>
      )}
    </div>
  );
}

function Excerpt({ text, n = 220 }) {
  const [open, setOpen] = useState(false);
  if (!text?.trim()) return <p className="excerpt muted small">No text (image or share only).</p>;
  const long = text.length > n;
  return (
    <p className="excerpt">
      {open ? text : long ? `${text.replace(/\s*\n\s*/g, ' ').slice(0, n).trimEnd()}…` : text.replace(/\n{2,}/g, '\n')}
      {long && <button className="link" onClick={() => setOpen(!open)}>{open ? 'less' : 'more'}</button>}
    </p>
  );
}

/* ----------------------------- engagement plan ------------------------------ */

/* Clipboard API first; some browsers and embedded views block it, so fall back to the
   classic hidden-textarea copy. If both fail, say so instead of pretending. */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function CopyButton({ text }) {
  const [state, setState] = useState('');
  return (
    <button className="copy" onClick={async () => {
      setState((await copyText(text)) ? 'Copied' : 'Select and copy');
      setTimeout(() => setState(''), 1800);
    }}>{state || 'Copy'}</button>
  );
}

function Evidence({ ids = [], index = {} }) {
  if (!ids.length) return null;
  return (
    <div className="evidence">
      {[...new Set(ids)].filter((id) => index[id]).map((id) => {
        const e = index[id];
        const label = `${e.kind === 'proof' ? 'Proof' : e.kind === 'stat' ? 'Stat' : e.kind === 'fact' ? 'Fact' : e.kind === 'person' ? 'Person' : 'Post'}: ${e.label}`;
        return e.url
          ? <a key={id} className="ev" href={e.url} target="_blank" rel="noreferrer" title={e.text}>{label}</a>
          : <span key={id} className="ev" title={e.text}>{label}</span>;
      })}
    </div>
  );
}

function Draft({ title, sub, text, ids, index, extra }) {
  return (
    <div className="draft">
      <div className="draft-head"><h3>{title}</h3>{sub && <span className="muted small">{sub}</span>}<CopyButton text={text} /></div>
      <p className="draft-text">{text}</p>
      {extra}
      <Evidence ids={ids} index={index} />
    </div>
  );
}

function EngagementPlan({ b, slug, go, picking, selected, startPicking, stopPicking, onStarted }) {
  const [code, setCode] = useState(safeStore.get('accessCode'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const d = b.draft;
  const running = d?.status === 'running';
  const o = d?.status === 'done' ? d.output : null;

  async function start(pickUrls = []) {
    setErr(''); setBusy(true);
    try { safeStore.set('accessCode', code); await api.draft(slug, pickUrls, code); onStarted(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  const controls = (
    <div className="plan-actions">
      {!code && <input className="code" value={code} onChange={(e) => setCode(e.target.value)} type="password" placeholder="Access code" aria-label="Access code" />}
      {picking ? (
        <>
          <button className="pill" disabled={busy || running} onClick={() => start(selected)}>{busy ? 'Starting…' : selected.length === 0 ? 'Redraft with AI picks' : selected.length === 1 ? 'Redraft with your pick' : `Redraft with your ${selected.length} picks`}</button>
          <button className="pill ghost" onClick={stopPicking}>Cancel</button>
        </>
      ) : (
        <>
          <button className="pill" disabled={busy || running} onClick={() => start([])}>{busy ? 'Starting…' : o || d?.status === 'failed' ? 'Redraft' : 'Draft engagement plan'}</button>
          {o && <button className="pill ghost" disabled={running} onClick={startPicking}>Swap posts</button>}
        </>
      )}
    </div>
  );

  return (
    <div className="card plan">
      <div className="card-head">
        <h2>Engagement plan</h2>
        <span className="muted small">Copy only. Nothing is posted, sent or connected for you.</span>
      </div>

      {running && (
        <div className="banner"><span className="spinner" aria-hidden="true" /><span>Drafting comments, your post, the connection request and the first DM. Usually under a minute; you can leave this page.</span></div>
      )}
      {d?.status === 'failed' && <p className="error">The draft failed: {d.error}</p>}
      {err && <p className="error">{err}</p>}

      {!d && !running && (
        <p className="muted">Picks three recent posts to engage with this week, then drafts a comment for each, a post for your own page, a connection request and a first DM to {chooseTargetName(b)}, grounded in the research and your <a href="/playbook" onClick={(e) => { e.preventDefault(); go({ page: 'playbook' }); }}>Playbook</a>.</p>
      )}

      {picking && (
        <>
          <p className="pickhint">Tick up to 3 posts in the feed below ({selected.length}/3), then redraft. Fewer than 3 and the AI fills the rest.</p>
          {controls}
        </>
      )}

      {o && !picking && (
        <>
          {o.playbook_status === 'seed' && (
            <p className="note-line">Drafted from the seed Playbook. Add your own example comments and DMs in <a href="/playbook" onClick={(e) => { e.preventDefault(); go({ page: 'playbook' }); }}>Playbook</a> to make the copy sound like you.</p>
          )}
          {(o.problems || []).length > 0 && (
            <div className="flags">
              <strong>Check before using ({o.problems.length}):</strong>
              <ul>{o.problems.map((p, i) => <li key={i}>{p.where}: {p.issue}</li>)}</ul>
            </div>
          )}

          {(o.sequence || []).length > 0 && (
            <div className="sequence">
              <h3 className="plan-step">This week, in order</h3>
              <ol>{o.sequence.map((step, i) => <li key={i}>{step}</li>)}</ol>
            </div>
          )}

          <details className="plan-sec" open>
          <summary><h3 className="plan-step">1. {o.picks.length === 0 ? 'Posts to engage with' : o.picks.length === 1 ? 'Engage with this post' : `Engage with these ${o.picks.length === 3 ? 'three' : 'two'} posts`}</h3><span className="muted small">{o.picks.length} comment{o.picks.length === 1 ? '' : 's'}</span></summary>
          {o.picks.length < 3 && (
            <p className="note-line">
              {o.picks.length === 0 ? 'No posts with text from the past year, so there is nothing to comment on yet. ' : `Only ${o.picks.length} post${o.picks.length === 1 ? '' : 's'} with text from the past year. `}
              {o.brand_posts_pulled === false ? "The brand's LinkedIn page posts haven't been pulled for this account; run the research again to add them." : 'The rest of the plan still works from the research.'}
            </p>
          )}
          <div className="picks">
            {o.picks.map((p, i) => (
              <div key={p.url} className={`pickcard s-${p.source}`}>
                <div className="post-meta">
                  <span className="num">{i + 1}</span>
                  <span className="who">{p.author}</span>
                  <span className={`kind k-${p.source}`}>{SOURCE_TEXT[p.source]}</span>
                  {p.is_repost && <span className="kind">Repost</span>}
                  {p.older && <span className="kind k-older">{Math.max(3, Math.round((p.age_days || 0) / 30))} months old</span>}
                  <span className="when">{ago(p.posted_at)}</span>
                  <a href={p.url} target="_blank" rel="noreferrer">Open post</a>
                </div>
                <Excerpt text={p.excerpt} n={180} />
                <p className="why"><span>{p.by === 'ben' ? 'Your pick' : 'Why'}:</span> {p.reason}</p>
                <Draft title="Your comment" text={p.comment.text} ids={p.comment.evidence} index={o.evidence} />
              </div>
            ))}
          </div>

          </details>

          <details className="plan-sec" open>
          <summary><h3 className="plan-step">2. Post this on your own page</h3><span className="muted small">never names the brand</span></summary>
          <Draft title="Your post" sub="Never names the brand" text={o.own_post.text} ids={o.own_post.evidence} index={o.evidence}
            extra={o.own_post.needs_proof && <p className="note-line">No {o.own_post.closest_category_used || 'same-category'} customer result with a number is in the Playbook yet, so the numbers here come from other categories. Add one in Playbook if you have it.</p>} />

          </details>

          <details className="plan-sec" open>
          <summary><h3 className="plan-step">3. Connect{(o.outreach || []).length > 1 ? ' and work up' : ''}</h3><span className="muted small">{(o.outreach || legacyOutreach(o)).length} {(o.outreach || legacyOutreach(o)).length === 1 ? 'person' : 'people'} · open each one for their messages</span></summary>
          {(o.outreach || legacyOutreach(o)).map((p) => (
            <details key={p.name} className={`outreach r-${p.role}`}>
              <summary className="outreach-head">
                <strong>{p.name}</strong>
                {p.role === 'wedge' && !p.fallback ? <span className="badge">Wedge persona</span> : p.role === 'bridge' ? <span className="kind">Team · bridge</span> : <span className="kind">Most senior found</span>}
                {p.track && <span className={`track t-${p.track}`}>{p.track === 'pdf' ? 'PDF' : 'Loom'}</span>}
                <span className="muted small outreach-title">{p.title}{p.role === 'wedge' && PERSONA_TEXT[p.persona] ? ` · ${PERSONA_TEXT[p.persona]}` : ''}</span>
                {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>LinkedIn</a>}
              </summary>
              {p.track_reason && <p className="why"><span>Why {p.track === 'pdf' ? 'the PDF' : 'a Loom'}:</span> {p.track_reason}.</p>}
              {p.why && <p className="why">{p.why}</p>}
              <Draft title={p.track ? `Connection request (offers the ${p.asset || (p.track === 'pdf' ? 'PDF' : 'Loom')})` : 'Connection request'} sub={`${p.connection.chars}/${p.connection.limit} characters`} text={p.connection.text} ids={p.connection.evidence} index={o.evidence} />
              {p.dm?.text && <Draft title={p.track ? `First DM (after they accept: sends the ${p.track === 'pdf' ? 'PDF' : 'Loom'} + CTA)` : 'First DM (after they accept)'} text={p.dm.text} ids={p.dm.evidence} index={o.evidence} />}
              {(o.outlines || []).filter((x) => x.track === p.track).map((x) => (
                <div key={x.track} className="outline">
                  <h4>What the {x.track === 'pdf' ? 'PDF' : 'Loom'} would cover</h4>
                  <ul>{x.bullets.map((bl, i) => <li key={i}>{bl.text}</li>)}</ul>
                  <Evidence ids={[...new Set(x.bullets.flatMap((bl) => bl.evidence))]} index={o.evidence} />
                </div>
              ))}
            </details>
          ))}
          </details>

          {o.notes_for_ben && <p className="note-line"><strong>Notes:</strong> {o.notes_for_ben}</p>}
          <p className="muted small">Drafted {day(d.finished_at)} with {d.model} · {usd(d.cost_usd)}</p>
        </>
      )}
      {!picking && controls}
    </div>
  );
}

/* Drafts made before the outreach update had one target and one connection note. */
function legacyOutreach(o) {
  if (!o.target) return [];
  return [{ ...o.target, role: 'wedge', why: null, connection: o.connection_request, dm: o.first_dm }];
}

function chooseTargetName(b) {
  for (const p of WEDGE) { const s = b.stakeholders.find((x) => x.persona === p); if (s) return s.full_name; }
  return 'the most senior person found';
}

/* ------------------------------- case studies ------------------------------- */

function CaseStudies({ b, go }) {
  const [pb, setPb] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api.playbook().then((r) => setPb(r.content)).catch(() => setPb(null)); }, []);
  if (!pb) return null;
  const industry = detectIndustry(b);
  const studies = rankCaseStudies(pb.proof, industry?.key);
  const company = companyWide(pb.proof);
  const matches = studies.filter((c) => c.match).length;
  // Same-space customers, plus the two strongest stories with numbers from elsewhere.
  const adjacent = studies.filter((c) => c.adjacent);
  const strongest = studies.filter((c) => !c.match && !c.adjacent && c.results.length).slice(0, 2);
  const shown = all ? studies : [...studies.filter((c) => c.match), ...adjacent, ...strongest].slice(0, Math.max(4, matches + adjacent.length + strongest.length));
  const toPlaybook = (e) => { e.preventDefault(); go({ page: 'playbook' }); };
  return (
    <div className="card cases">
      <div className="card-head">
        <h2>Relevant case studies</h2>
        <span className="muted small">
          {industry ? <>Looks like <strong>{industry.key}</strong> from its research · {matches ? `${matches} customer${matches === 1 ? '' : 's'} in the same space` : 'no customers in the same space yet'}</> : 'Industry not clear from the research'}
        </span>
      </div>
      <div className="case-grid">
        {shown.map((c) => (
          <div key={c.customer} className={`case${c.match ? ' is-match' : ''}`}>
            <div className="case-head">
              <strong>{c.customer}</strong>
              {c.match ? <span className="badge">Same space</span> : c.adjacent ? <span className="kind k-adjacent">Adjacent: {c.category}</span> : <span className="kind">{c.category}{c.results.length ? ' · strong numbers' : ''}</span>}
            </div>
            {c.results.length > 0 ? (
              <ul>{c.results.slice(0, 3).map((r) => <li key={r.id}>{r.claim}</li>)}</ul>
            ) : c.quotes.length > 0 ? (
              <ul>{c.quotes.slice(0, 2).map((q) => <li key={q.id}>{q.claim}</li>)}</ul>
            ) : (
              <p className="muted small">Nectar customer. No published results yet.</p>
            )}
            {c.results.length === 0 && <p className="case-note">No numbers to quote; name them as a customer only.</p>}
            {c.source_url && <a className="case-link" href={c.source_url} target="_blank" rel="noreferrer">Source</a>}
          </div>
        ))}
      </div>
      {studies.length > shown.length && <button className="link more" onClick={() => setAll(true)}>Show {studies.length - shown.length} more</button>}
      {company.length > 0 && (
        <p className="case-company"><strong>Nectar overall:</strong> {company.map((p) => p.claim).join(' ')}</p>
      )}
      <p className="muted small">From the <a href="/playbook" onClick={toPlaybook}>Playbook</a> proof library. Add results there and they show up here and in drafts.</p>
    </div>
  );
}

/* Signals: recent changes at the account, grouped, newest first, each with its receipt. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function signalDate(raw) {
  const m = String(raw || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return 'Date not stated';
  return m[2] ? `${MONTHS[Number(m[2]) - 1]}${m[3] ? ` ${Number(m[3])},` : ''} ${m[1]}` : m[1];
}

function Signals({ b }) {
  const [showOld, setShowOld] = useState({});
  const { groups, count } = buildSignals(b);
  if (!b.profile && !groups.length) return null;
  return (
    <div className="card signals">
      <div className="card-head">
        <h2>Signals</h2>
        <span className="muted small">{count ? `${count} in the last 2 years · newest first · dates are the source's date` : 'Nothing recent found in the research'}</span>
      </div>
      {groups.length === 0 ? (
        <p className="muted">No new seats, leadership changes, corporate events, launches or results turned up in this research.</p>
      ) : (
        <div className="signal-groups">
          {groups.map((g) => {
            const older = g.items.filter((i) => i.older);
            const shown = showOld[g.key] ? g.items : g.items.filter((i) => !i.older);
            return (
              <section key={g.key} className={`signal-group sg-${g.key}`}>
                <h3>{g.title}<span>{g.sub}</span></h3>
                <ul>
                  {shown.map((i, n) => {
                    const raw = i.ref.type === 'fact' ? i.ref.fact.date : i.ref.person.started_role_at;
                    return (
                      <li key={n} className={i.older ? 'is-old' : ''}>
                        <span className="sig-date">{signalDate(raw)}{i.recent && <span className="sig-new">New</span>}</span>
                        <span className="sig-text">
                          {i.text}
                          <span className="sig-src">
                            {i.ref.type === 'fact' ? (
                              <><Label value={i.ref.fact.label} /> <a href={i.ref.fact.url} target="_blank" rel="noreferrer" title={i.ref.fact.quote}>{hostname(i.ref.fact.url)}</a></>
                            ) : (
                              <>Apollo job history{i.ref.person.linkedin_url && <> · <a href={i.ref.person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>}</>
                            )}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {older.length > 0 && (
                  <button className="link more" onClick={() => setShowOld((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                    {showOld[g.key] ? 'Hide older' : `Show ${older.length} older`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Summary({ points, factById }) {
  const [all, setAll] = useState(false);
  const shown = all ? points : points.slice(0, 5);
  return (
    <>
      <ul className="summary">
        {shown.map((s, i) => <li key={i}>{s.text}<Cites ids={s.fact_ids} factById={factById} /></li>)}
      </ul>
      {points.length > 5 && <button className="link more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show ${points.length - 5} more`}</button>}
    </>
  );
}

function PersonRow({ s, wedge }) {
  return (
    <tr className={wedge ? 'wedge' : 'team'}>
      <td>
        {s.linkedin_url ? <a href={s.linkedin_url} target="_blank" rel="noreferrer">{s.full_name}</a> : s.full_name}
        {wedge && <span className="badge">Wedge persona</span>}
      </td>
      <td>{s.title}</td>
      <td>{PERSONA_TEXT[s.persona] || s.persona}</td>
      <td className="nowrap">{months(s.tenure_months)} <span className="muted small">in role</span></td>
      <td><Activity p={s.post_pattern} /></td>
    </tr>
  );
}

function Activity({ p }) {
  if (!p) return <span className="muted small">—</span>;
  const top = Object.entries(p.by_topic || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k.replace('_', ' ')).join(', ');
  return (
    <span className="small">
      {p.own} posts{top ? ` · mostly ${top}` : ''}{!p.posts_tactics && p.own ? ' · no tactics' : ''}
      {p.latest_own && <> · <a href={p.latest_own.url} target="_blank" rel="noreferrer">latest</a></>}
    </span>
  );
}

function OwnershipLine({ own, reporting, factById }) {
  if (!own?.status) return null;
  const text = {
    subsidiary: `Owned by ${own.parent_company}`,
    independent_public: `Independent, publicly traded${own.ticker ? ` (${own.ticker})` : ''}`,
    independent_private: 'Independent, privately held',
    unknown: 'Ownership not confirmed',
  }[own.status];
  const rep = reporting?.status === 'found' ? reporting.note : reporting?.status === 'none_public' ? null : reporting?.note;
  return <p className="ownership">{text}<Cites ids={own.fact_ids} factById={factById} />{rep && <span className="muted"> · {rep}</span>}</p>;
}

function Cites({ ids = [], factById }) {
  const shown = ids.filter((id) => factById[id]);
  if (!shown.length) return null;
  return <sup className="cites">{shown.map((id) => <a key={id} href={factById[id].url} target="_blank" rel="noreferrer" title={factById[id].quote}>{id}</a>)}</sup>;
}

function Label({ value }) {
  if (!value) return null;
  return <span className={`label l-${value}`}>{LABEL_TEXT[value] || value}</span>;
}

/* --------------------------------- playbook -------------------------------- */

const lines = (arr) => (arr || []).join('\n');
// While editing keep every line (so Enter works); empties are dropped on save.
const unlines = (s) => String(s || '').split('\n');
const blocks = (arr) => (arr || []).join('\n---\n');
const unblocks = (s) => String(s || '').split(/\n---\n/);
const tidy = (arr) => (arr || []).map((x) => String(x).trim()).filter(Boolean);
function cleanPlaybook(pb) {
  return {
    ...pb,
    product: { ...pb.product, value_props: tidy(pb.product.value_props), pains: tidy(pb.product.pains) },
    voice: { tone: tidy(pb.voice.tone), use: tidy(pb.voice.use) },
    banned: tidy(pb.banned),
    examples: Object.fromEntries(Object.entries(pb.examples).map(([k, v]) => [k, tidy(v)])),
    rules: { ...pb.rules, extra: tidy(pb.rules.extra) },
    tracks: Object.fromEntries(Object.entries(pb.tracks || {}).map(([k, t]) => [k, { ...t, connection_notes: tidy(t.connection_notes), first_dms: tidy(t.first_dms) }])),
    proof: pb.proof.filter((p) => p.claim.trim() || p.customer.trim()),
  };
}

const PROOF_KIND = { result: 'Result', quote: 'Quote', customer: 'Customer', company: 'Company-wide' };
const count = (arr, one, many = `${one}s`) => { const n = (arr || []).filter((x) => String(x).trim()).length; return `${n} ${n === 1 ? one : many}`; };

/* A collapsible Playbook section: title and a one-line summary, closed by default. */
function Section({ title, meta, children }) {
  return (
    <details className="card section">
      <summary><h2>{title}</h2>{meta && <span className="muted small">{meta}</span>}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function PlaybookPage() {
  const [pb, setPb] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState(safeStore.get('accessCode'));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [added, setAdded] = useState([]); // proof entries added this visit start open
  useEffect(() => { api.playbook().then((r) => { setPb(r.content); setMeta(r); }).catch((ex) => setErr(ex.message)); }, []);
  if (err && !pb) return <section className="page"><p className="error">{err}</p></section>;
  if (!pb) return <section className="page"><p className="muted">Loading…</p></section>;

  const set = (path, value) => {
    setDirty(true); setMsg('');
    setPb((cur) => {
      const next = structuredClone(cur);
      let o = next; for (const k of path.slice(0, -1)) o = o[k];
      o[path.at(-1)] = value;
      return next;
    });
  };
  async function save(markReviewed) {
    setErr(''); setMsg(''); setBusy(true);
    try {
      safeStore.set('accessCode', code);
      const content = { ...cleanPlaybook(pb), status: markReviewed ? 'reviewed' : pb.status };
      const r = await api.savePlaybook(content, code);
      setPb(r.content); setMeta(r); setDirty(false); setMsg('Saved. New drafts use this version.');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  const T = ({ label, hint, path, rows = 3, value, onChange }) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {hint && <span className="field-hint">{hint}</span>}
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  return (
    <section className="page playbook">
      <header className="page-head">
        <h1>Playbook</h1>
        <p className="muted">What every engagement draft is grounded in. Drafts may only state results from the proof library.</p>
        <p className="small">
          {pb.status === 'seed' ? <span className="seedtag">Seed version: drafted from Nectar's public site, check it</span> : <span className="okt">Reviewed</span>}
          {meta?.saved ? <span className="muted"> · saved {day(meta.created_at)}</span> : <span className="muted"> · not saved yet (using the built-in seed)</span>}
        </p>
      </header>

      <Section title="You" meta={[pb.sender.name, pb.sender.role].filter(Boolean).join(' · ')}>
        <div className="grid2">
          <label className="field"><span className="field-label">Name</span><input value={pb.sender.name} onChange={(e) => set(['sender', 'name'], e.target.value)} /></label>
          <label className="field"><span className="field-label">Role</span><input value={pb.sender.role} onChange={(e) => set(['sender', 'role'], e.target.value)} /></label>
        </div>
        <label className="field"><span className="field-label">LinkedIn headline</span><input value={pb.sender.headline} onChange={(e) => set(['sender', 'headline'], e.target.value)} placeholder="What people see under your name" /></label>
      </Section>

      <Section title="What Nectar sells" meta={`${count(pb.product.value_props, 'value prop')} · ${count(pb.product.pains, 'pain')}`}>
        {T({ label: 'One-liner', rows: 3, value: pb.product.one_liner, onChange: (v) => set(['product', 'one_liner'], v) })}
        {T({ label: 'Value props', hint: 'One per line', rows: 5, value: lines(pb.product.value_props), onChange: (v) => set(['product', 'value_props'], unlines(v)) })}
        {T({ label: "Who it's for", rows: 2, value: pb.product.who_its_for, onChange: (v) => set(['product', 'who_its_for'], v) })}
        {T({ label: 'Pains it solves', hint: 'One per line', rows: 4, value: lines(pb.product.pains), onChange: (v) => set(['product', 'pains'], unlines(v)) })}
      </Section>

      <Section title="Proof library" meta={`${count(pb.proof, 'entry', 'entries')} from ${count([...new Set(pb.proof.map((p) => p.customer).filter(Boolean))], 'customer')}`}>
        <p className="muted small">The only results drafts may state, each credited to its customer.</p>
        <div className="proofs">
          {pb.proof.map((p, i) => (
            <details key={p.id} className="proof" open={added.includes(p.id) || undefined}>
              <summary>
                <strong>{p.customer || 'New entry'}</strong>
                <span className="kind">{PROOF_KIND[p.kind] || p.kind}</span>
                <span className="proof-claim">{p.claim}</span>
              </summary>
              <div className="grid3">
                <label className="field"><span className="field-label">Customer</span><input value={p.customer} onChange={(e) => set(['proof', i, 'customer'], e.target.value)} /></label>
                <label className="field"><span className="field-label">Category</span><input value={p.category} onChange={(e) => set(['proof', i, 'category'], e.target.value)} /></label>
                <label className="field"><span className="field-label">Type</span>
                  <select value={p.kind} onChange={(e) => set(['proof', i, 'kind'], e.target.value)}>
                    <option value="result">Result (has a number)</option><option value="quote">Quote</option><option value="customer">Named customer</option><option value="company">Company-wide</option>
                  </select>
                </label>
              </div>
              <label className="field"><span className="field-label">Claim</span><textarea rows={2} value={p.claim} onChange={(e) => set(['proof', i, 'claim'], e.target.value)} /></label>
              <div className="proof-foot">
                <label className="field grow"><span className="field-label">Source URL</span><input value={p.source_url} onChange={(e) => set(['proof', i, 'source_url'], e.target.value)} /></label>
                <button className="link danger" onClick={() => set(['proof'], pb.proof.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </details>
          ))}
        </div>
        <button className="pill ghost" onClick={() => {
          const n = Math.max(0, ...pb.proof.map((p) => Number(String(p.id).replace(/\D/g, '')) || 0)) + 1;
          set(['proof'], [...pb.proof, { id: `p${n}`, customer: '', category: '', claim: '', source_url: '', kind: 'result' }]);
          setAdded((a) => [...a, `p${n}`]);
        }}>Add proof</button>
      </Section>

      <Section title="Voice" meta={`${count(pb.voice.tone, 'tone rule')} · ${count(pb.banned, 'banned phrase')}`}>
        {T({ label: 'Tone rules', hint: 'One per line', rows: 4, value: lines(pb.voice.tone), onChange: (v) => set(['voice', 'tone'], unlines(v)) })}
        {T({ label: 'Words and phrases that fit', hint: 'One per line', rows: 3, value: lines(pb.voice.use), onChange: (v) => set(['voice', 'use'], unlines(v)) })}
        {T({ label: 'Never use', hint: 'One per line. Em dashes are always removed.', rows: 5, value: lines(pb.banned), onChange: (v) => set(['banned'], unlines(v)) })}
      </Section>

      <Section title="Message tracks" meta={pb.tracks ? `PDF: ${count(pb.tracks.pdf.connection_notes, 'note')}, ${count(pb.tracks.pdf.first_dms, 'DM')} · Loom: ${count(pb.tracks.loom.connection_notes, 'note')}, ${count(pb.tracks.loom.first_dms, 'DM')}` : ''}>
        <p className="muted small">The connection request makes the offer; the first DM delivers it with the CTA. The most senior tier found at an account gets the PDF track; everyone below gets the Loom track. Each person's note and DM always come from the same track. Slots in {'{braces}'} are filled from the research; separate templates with a line of ---</p>
        {pb.tracks && ['pdf', 'loom'].map((k) => (
          <div key={k} className="trackbox">
            <h3><span className={`track t-${k}`}>{k === 'pdf' ? 'PDF' : 'Loom'}</span> {k === 'pdf' ? 'Top tier found (C-suite or VP, else the most senior person)' : 'Everyone below the top tier'}</h3>
            <label className="field"><span className="field-label">Asset name</span><input value={pb.tracks[k].asset} onChange={(e) => set(['tracks', k, 'asset'], e.target.value)} /></label>
            {T({ label: 'Connection note templates (make the offer)', rows: 5, value: blocks(pb.tracks[k].connection_notes), onChange: (v) => set(['tracks', k, 'connection_notes'], unblocks(v)) })}
            {T({ label: 'First DM templates (deliver it + CTA)', rows: 6, value: blocks(pb.tracks[k].first_dms), onChange: (v) => set(['tracks', k, 'first_dms'], unblocks(v)) })}
          </div>
        ))}
      </Section>

      <Section title="Examples and templates" meta={[count(pb.examples.posts, 'post'), count(pb.examples.comments, 'comment')].join(' · ')}>
        <p className="muted small">Comment examples and post templates. Separate examples with a line of ---</p>
        {T({ label: 'Comments', rows: 5, value: blocks(pb.examples.comments), onChange: (v) => set(['examples', 'comments'], unblocks(v)) })}
        {T({ label: 'Posts', rows: 6, value: blocks(pb.examples.posts), onChange: (v) => set(['examples', 'posts'], unblocks(v)) })}
      </Section>

      <Section title="Rules" meta={`${pb.rules.connection_note_max}-character connection notes · ${count(pb.rules.extra, 'rule')}`}>
        <div className="grid2">
          <label className="field"><span className="field-label">Connection note limit (characters)</span>
            <input type="number" min={100} max={300} value={pb.rules.connection_note_max} onChange={(e) => set(['rules', 'connection_note_max'], Number(e.target.value))} /></label>
          <label className="field"><span className="field-label">First DM call to action</span><input value={pb.rules.dm_cta || ''} onChange={(e) => set(['rules', 'dm_cta'], e.target.value)} /></label>
        </div>
        {T({ label: 'Other rules', hint: 'One per line', rows: 4, value: lines(pb.rules.extra), onChange: (v) => set(['rules', 'extra'], unlines(v)) })}
      </Section>

      <div className="savebar">
        {!code && <input className="code" value={code} onChange={(e) => setCode(e.target.value)} type="password" placeholder="Access code" aria-label="Access code" />}
        <button className="pill" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save'}</button>
        {pb.status === 'seed' && <button className="pill ghost" disabled={busy} onClick={() => save(true)}>Save and mark reviewed</button>}
        {dirty && <span className="muted small">Unsaved changes</span>}
        {msg && <span className="okt small">{msg}</span>}
        {err && <span className="error small">{err}</span>}
      </div>
    </section>
  );
}

/* ---------------------------------- spend --------------------------------- */

function SpendPage({ go, live }) {
  const { data, err } = useLiveData(() => api.runs(), [live.finished], (d) => d.runs.some((r) => ['running', 'queued'].includes(r.status)));
  const [open, setOpen] = useState(null);
  if (err) return <section className="page"><p className="error">{err}</p></section>;
  if (!data) return <section className="page"><p className="muted">Loading…</p></section>;

  const { runs, capUsd } = data;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const sum = (list) => list.reduce((s, r) => s + r.cost_usd, 0);
  const todays = runs.filter((r) => String(r.created_at).slice(0, 10) === today);
  const months_ = runs.filter((r) => String(r.created_at).slice(0, 7) === month);
  const monthRuns = months_.filter((r) => r.kind !== 'draft').length;
  const monthDrafts = months_.length - monthRuns;
  const finished = runs.filter((r) => r.kind !== 'draft' && r.finished_at && r.status !== 'failed');
  const avg = finished.length ? sum(finished) / finished.length : 0;

  return (
    <section className="page">
      <header className="page-head"><h1>Spend</h1><p className="muted">What each live run cost, from the providers' own usage numbers.</p></header>
      <div className="tiles">
        <div className="tile"><span>Today</span><strong>{usd(sum(todays))}</strong><em>of {usd(capUsd)} daily cap</em><div className="bar"><i style={{ width: `${Math.min(100, (sum(todays) / capUsd) * 100)}%` }} /></div></div>
        <div className="tile"><span>This month</span><strong>{usd(sum(months_))}</strong><em>{monthRuns} {monthRuns === 1 ? 'run' : 'runs'}{monthDrafts ? `, ${monthDrafts} ${monthDrafts === 1 ? 'draft' : 'drafts'}` : ''}</em></div>
        <div className="tile"><span>Average run</span><strong>{usd(avg)}</strong><em>completed research runs</em></div>
      </div>
      <div className="card flush">
        <table className="list">
          <thead><tr><th>Date</th><th>Brand</th><th>Status</th><th className="num">Duration</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <React.Fragment key={r.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="nowrap">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>{r.brand ? <a href={pathFor({ page: 'account', slug: r.brand.slug })} onClick={(e) => { e.preventDefault(); e.stopPropagation(); go({ page: 'account', slug: r.brand.slug }); }}>{r.brand.name}</a> : <span className="muted">—</span>}</td>
                  <td><span className={`status s-${r.status}`}>{r.status}</span>{r.kind === 'draft' && <span className="muted small"> · engagement draft</span>}</td>
                  <td className="num">{secs(r.started_at, r.finished_at) ?? '—'}{secs(r.started_at, r.finished_at) !== null ? 's' : ''}</td>
                  <td className="num">{usd(r.cost_usd)} <span className="chev">{open === r.id ? '▾' : '▸'}</span></td>
                </tr>
                {open === r.id && (
                  <tr className="breakdown"><td colSpan={5}>
                    {r.kind === 'draft' ? <span>Claude drafting (comments, post, connection request, DM): <strong>{usd(r.cost_usd)}</strong></span> : STEPS.map(([key, label]) => {
                      const m = r.modules.find((x) => x.module === key);
                      return <span key={key}>{label}: <strong>{m ? usd(m.cost_usd) : '—'}</strong></span>;
                    })}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------------- icons --------------------------------- */

function IconSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>; }
function IconList() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
function IconCoins() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M15 11.5c3.1.2 6 1.4 6 3V19c0 1.7-2.7 3-6 3-2 0-3.7-.5-4.8-1.2" /></svg>; }
function IconBook() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" /><path d="M8 7h8M8 11h6" /></svg>; }
function IconCheck() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>; }
function IconLayers() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>; }
function IconScissors() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></svg>; }
