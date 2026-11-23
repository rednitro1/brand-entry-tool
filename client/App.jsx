import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

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
  if (parts[0] === 'accounts' && parts[1]) return { page: 'account', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'accounts') return { page: 'accounts' };
  if (parts[0] === 'spend') return { page: 'spend' };
  return { page: 'search' };
}
function pathFor(r) {
  if (r.page === 'account') return `/accounts/${encodeURIComponent(r.slug)}`;
  if (r.page === 'accounts') return '/accounts';
  if (r.page === 'spend') return '/spend';
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

  const tab = route.page === 'account' ? 'accounts' : route.page;
  return (
    <div className="shell">
      <Sidebar tab={tab} go={go} />
      <main className="content">
        {route.page === 'search' && <SearchPage go={go} />}
        {route.page === 'accounts' && <AccountsPage go={go} />}
        {route.page === 'account' && <AccountPage slug={route.slug} go={go} />}
        {route.page === 'spend' && <SpendPage go={go} />}
      </main>
    </div>
  );
}

function Sidebar({ tab, go }) {
  const items = [['search', 'Search', IconSearch], ['accounts', 'Accounts', IconList], ['spend', 'Spend', IconCoins]];
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
      <p className="byline">Prototype by Ben Sollitt. Recommends only; never acts on LinkedIn.</p>
    </aside>
  );
}

/* --------------------------------- search --------------------------------- */

function SearchPage({ go }) {
  const [input, setInput] = useState('');
  const [code, setCode] = useState(safeStore.get('accessCode'));
  const [showCode, setShowCode] = useState(!safeStore.get('accessCode'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      safeStore.set('accessCode', code);
      const r = await api.startRun(input, code);
      setRunId(r.runId);
    } catch (ex) {
      setErr(ex.message);
      if (ex.status === 401) setShowCode(true);
    } finally { setBusy(false); }
  }

  return (
    <section className="center">
      <div className="hero">
        <h1>Research a brand</h1>
        <p className="lede">Brand profile, wedge personas, social pages and receipts for every claim.</p>
        {!runId ? (
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
            <p className="hint">Live runs take 1 to 3 minutes and need an access code. Past research is open to everyone under <a href="/accounts" onClick={(e) => { e.preventDefault(); go({ page: 'accounts' }); }}>Accounts</a>.</p>
          </form>
        ) : (
          <RunProgress runId={runId} input={input} onDone={(slug) => go({ page: 'account', slug })} onReset={() => { setRunId(null); setInput(''); }} />
        )}
      </div>
    </section>
  );
}

function RunProgress({ runId, input, onDone, onReset }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const r = await api.run(runId);
        if (stop) return;
        setRun(r);
        const finished = ['done', 'partial', 'failed'].includes(r.status);
        if (finished && r.brand?.slug && r.status !== 'failed') { setTimeout(() => !stop && onDone(r.brand.slug), 900); return; }
        if (!finished) setTimeout(tick, 2500);
      } catch (ex) { if (!stop) setErr(ex.message); }
    }
    tick();
    return () => { stop = true; };
  }, [runId]);

  const byModule = Object.fromEntries((run?.modules || []).map((m) => [m.module, m]));
  return (
    <div className="progress">
      <p className="progress-title">Researching <strong>{input}</strong></p>
      <ol>
        {STEPS.map(([key, label]) => {
          const st = byModule[key]?.status || 'queued';
          return (
            <li key={key} className={`step st-${st}`}>
              <span className="dot">{st === 'done' ? <IconCheck /> : st === 'failed' || st === 'skipped' ? '!' : ''}</span>
              <span>{label}</span>
              <span className="state">{st === 'running' ? 'working…' : st === 'failed' ? 'failed' : st === 'skipped' ? 'skipped' : ''}</span>
            </li>
          );
        })}
      </ol>
      {err && <p className="error">{err}</p>}
      {run?.status === 'failed' && (
        <>
          <p className="error">{run.error || 'The run failed.'}</p>
          <button className="pill ghost" onClick={onReset}>Try another brand</button>
        </>
      )}
    </div>
  );
}

/* -------------------------------- accounts -------------------------------- */

function AccountsPage({ go }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.brands().then(setRows).catch((ex) => setErr(ex.message)); }, []);
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
                  <td><strong>{b.name}</strong><div className="muted small">{b.domain || ''}</div></td>
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

function AccountPage({ slug, go }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setB(null); setErr(''); api.brand(slug).then(setB).catch((ex) => setErr(ex.message)); }, [slug]);
  if (err) return <section className="page"><p className="error">{err}</p></section>;
  if (!b) return <section className="page"><p className="muted">Loading…</p></section>;

  const { brand, profile, stakeholders, social, lastRun } = b;
  const facts = profile?.facts || [];
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));
  const wedge = stakeholders.filter((s) => WEDGE.includes(s.persona)).sort((a, c) => WEDGE.indexOf(a.persona) - WEDGE.indexOf(c.persona));
  const team = stakeholders.filter((s) => !WEDGE.includes(s.persona));
  const gaps = brand.gaps || [];

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

      {profile && (profile.summary || []).length > 0 && (
        <div className="card">
          <h2>Summary</h2>
          <Summary points={profile.summary} factById={factById} />
        </div>
      )}

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

      {profile && (
        <details className="card receipts">
          <summary><h2>Facts and receipts</h2><span className="muted small">{facts.length} facts{(profile.conflicts || []).length ? `, ${profile.conflicts.length} disagreements` : ''}</span></summary>
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
        </details>
      )}
    </section>
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

/* ---------------------------------- spend --------------------------------- */

function SpendPage({ go }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { api.runs().then(setData).catch((ex) => setErr(ex.message)); }, []);
  if (err) return <section className="page"><p className="error">{err}</p></section>;
  if (!data) return <section className="page"><p className="muted">Loading…</p></section>;

  const { runs, capUsd } = data;
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const sum = (list) => list.reduce((s, r) => s + r.cost_usd, 0);
  const todays = runs.filter((r) => String(r.created_at).slice(0, 10) === today);
  const months_ = runs.filter((r) => String(r.created_at).slice(0, 7) === month);
  const finished = runs.filter((r) => r.finished_at && r.status !== 'failed');
  const avg = finished.length ? sum(finished) / finished.length : 0;

  return (
    <section className="page">
      <header className="page-head"><h1>Spend</h1><p className="muted">What each live run cost, from the providers' own usage numbers.</p></header>
      <div className="tiles">
        <div className="tile"><span>Today</span><strong>{usd(sum(todays))}</strong><em>of {usd(capUsd)} daily cap</em><div className="bar"><i style={{ width: `${Math.min(100, (sum(todays) / capUsd) * 100)}%` }} /></div></div>
        <div className="tile"><span>This month</span><strong>{usd(sum(months_))}</strong><em>{months_.length} {months_.length === 1 ? "run" : "runs"}</em></div>
        <div className="tile"><span>Average run</span><strong>{usd(avg)}</strong><em>completed runs</em></div>
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
                  <td><span className={`status s-${r.status}`}>{r.status}</span></td>
                  <td className="num">{secs(r.started_at, r.finished_at) ?? '—'}{secs(r.started_at, r.finished_at) !== null ? 's' : ''}</td>
                  <td className="num">{usd(r.cost_usd)} <span className="chev">{open === r.id ? '▾' : '▸'}</span></td>
                </tr>
                {open === r.id && (
                  <tr className="breakdown"><td colSpan={5}>
                    {STEPS.map(([key, label]) => {
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
function IconCheck() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>; }
