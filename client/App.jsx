import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const LABEL_TEXT = {
  verified: 'Verified',
  single_source: 'Single source',
  inferred: 'Inferred',
  vendor_claim: 'Vendor claim',
  unverified: 'Unverified',
};
const PERSONA_TEXT = {
  cmo: 'CMO', director_social: 'Director of Social', chief_digital: 'Chief Digital Officer',
  director_cx: 'Director of CX', team_social: 'Social / community team',
};
const MODULE_TEXT = { resolve: 'Find brand and accounts', profile: 'Brand profile', stakeholders: 'Stakeholders', social: 'Social page stats' };

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const months = (m) => (m === null || m === undefined ? '—' : m >= 12 ? `${Math.floor(m / 12)}y ${m % 12}m` : `${m}m`);
const dur = (a, b) => (a && b ? `${Math.round((new Date(b) - new Date(a)) / 1000)}s` : '');

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return { brand: p.get('brand'), run: p.get('run') };
}
function setParams(next) {
  const p = new URLSearchParams();
  if (next.brand) p.set('brand', next.brand);
  if (next.run) p.set('run', next.run);
  window.history.pushState({}, '', `${window.location.pathname}${p.toString() ? `?${p}` : ''}`);
}
const safeStore = {
  get(k) { try { return window.localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export default function App() {
  const [params, setP] = useState(readParams());
  const [brands, setBrands] = useState([]);
  const go = useCallback((next) => { setParams(next); setP(next); }, []);

  useEffect(() => {
    const onPop = () => setP(readParams());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { api.brands().then(setBrands).catch(() => setBrands([])); }, [params.brand]);

  return (
    <main className="wrap">
      <header className="top">
        <h1><a href="/" onClick={(e) => { e.preventDefault(); go({}); }}>Brand Entry Tool</a></h1>
        <p className="muted">
          Researches a consumer brand and recommends a LinkedIn entry play into its social and marketing team.
          It only recommends. It never posts, comments, connects or messages on LinkedIn.
        </p>
      </header>

      <RunForm onStarted={(runId) => go({ run: runId })} />

      {brands.length > 0 && (
        <nav className="brands">
          <span className="muted">Researched:</span>
          {brands.map((b) => (
            <button key={b.slug} className={`chip ${params.brand === b.slug ? 'on' : ''}`} onClick={() => go({ brand: b.slug })}>
              {b.name}{b.is_example ? ' (example)' : ''}
            </button>
          ))}
        </nav>
      )}

      {params.run && <RunStatus runId={params.run} onDone={(slug) => go({ brand: slug, run: params.run })} />}
      {params.brand && <BrandView slug={params.brand} />}
    </main>
  );
}

function RunForm({ onStarted }) {
  const [input, setInput] = useState('');
  const [code, setCode] = useState(safeStore.get('accessCode'));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      safeStore.set('accessCode', code);
      const { runId } = await api.startRun(input, code);
      onStarted(runId);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <label>
        Brand name or LinkedIn company URL
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Alani Nu or linkedin.com/company/alani-nutrition" maxLength={200} required />
      </label>
      <label className="code">
        Access code (live runs cost money)
        <input value={code} onChange={(e) => setCode(e.target.value)} type="password" autoComplete="off" />
      </label>
      <button type="submit" disabled={busy || !input.trim()}>{busy ? 'Starting…' : 'Research'}</button>
      {err && <p className="error">{err}</p>}
    </form>
  );
}

function RunStatus({ runId, onDone }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stop = false;
    let notified = false;
    async function tick() {
      try {
        const r = await api.run(runId);
        if (stop) return;
        setRun(r);
        const finished = ['done', 'partial', 'failed'].includes(r.status);
        if (finished && r.brand?.slug && !notified) { notified = true; onDone(r.brand.slug); }
        if (!finished) setTimeout(tick, 3000);
      } catch (ex) { if (!stop) setErr(ex.message); }
    }
    tick();
    return () => { stop = true; };
  }, [runId]);

  if (err) return <p className="error">{err}</p>;
  if (!run) return <p className="muted">Loading run…</p>;
  const order = ['resolve', 'profile', 'stakeholders', 'social'];
  const mods = [...run.modules].sort((a, b) => order.indexOf(a.module) - order.indexOf(b.module));

  return (
    <section className="card">
      <h2>Run: {run.input} <span className={`status s-${run.status}`}>{run.status}</span></h2>
      <p className="muted">Cost {usd(run.cost_usd)} {run.finished_at ? `· ${dur(run.started_at, run.finished_at)}` : '· usually 1 to 3 minutes'}</p>
      <table className="mods">
        <tbody>
          {mods.map((m) => (
            <tr key={m.module}>
              <td>{MODULE_TEXT[m.module] || m.module}</td>
              <td><span className={`status s-${m.status}`}>{m.status}</span></td>
              <td className="num">{m.status === 'done' || m.status === 'failed' ? usd(m.cost_usd) : ''}</td>
              <td className="muted small">{m.error || (m.log && m.log.length ? m.log[m.log.length - 1].slice(9) : '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Label({ value }) {
  if (!value) return null;
  return <span className={`label l-${value}`}>{LABEL_TEXT[value] || value}</span>;
}

function BrandView({ slug }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setB(null); api.brand(slug).then(setB).catch((ex) => setErr(ex.message)); }, [slug]);
  if (err) return <p className="error">{err}</p>;
  if (!b) return <p className="muted">Loading…</p>;
  const { brand, profile, stakeholders, social, lastRun } = b;
  const facts = profile?.facts || [];
  const factById = Object.fromEntries(facts.map((f) => [f.id, f]));

  return (
    <article>
      <section className="card">
        <h2>{brand.name}</h2>
        <p className="muted">
          {brand.domain && <a href={`https://${brand.domain}`} target="_blank" rel="noreferrer">{brand.domain}</a>}
          {lastRun && <> · last run {usd(lastRun.cost_usd)}{lastRun.finished_at ? `, ${dur(lastRun.started_at, lastRun.finished_at)}` : ''}</>}
        </p>
        {profile ? (
          <>
            <Ownership own={profile.ownership} reporting={profile.reporting} factById={factById} />
            <ul className="summary">
              {(profile.summary || []).map((s, i) => (
                <li key={i}>{s.text} {s.fact_ids.map((id) => factById[id] && <a key={id} className="cite" href={factById[id].url} target="_blank" rel="noreferrer">[{id}]</a>)}</li>
              ))}
            </ul>
          </>
        ) : <p className="muted">No brand profile yet.</p>}
      </section>

      <section className="card">
        <h3>Stakeholders</h3>
        {(brand.gaps || []).length > 0 && (
          <ul className="gaps">{brand.gaps.map((g) => <li key={g.persona}>{g.note}</li>)}</ul>
        )}
        {stakeholders.length === 0 ? <p className="muted">No stakeholders found.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Name</th><th>Title (from provider record)</th><th>Persona</th><th>In role</th><th>At company</th><th>Source</th><th>LinkedIn posts</th></tr></thead>
              <tbody>
                {stakeholders.map((s) => (
                  <tr key={s.id}>
                    <td>{s.linkedin_url ? <a href={s.linkedin_url} target="_blank" rel="noreferrer">{s.full_name}</a> : s.full_name}</td>
                    <td>{s.title}</td>
                    <td>{PERSONA_TEXT[s.persona] || s.persona}</td>
                    <td>{months(s.tenure_months)}</td>
                    <td>{months(s.company_tenure_months)}</td>
                    <td>{s.found_via} <Label value={s.verification} /></td>
                    <td><PostPattern s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Social pages</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Platform</th><th>Account</th><th className="num">Followers</th><th className="num">Following</th><th className="num">Posts</th><th>Notes</th></tr></thead>
            <tbody>
              {['instagram', 'tiktok', 'x', 'linkedin'].map((p) => {
                const a = social.find((x) => x.platform === p);
                return (
                  <tr key={p}>
                    <td>{{ instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn' }[p]}</td>
                    <td>{a?.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.handle}</a> : '—'}</td>
                    <td className="num">{fmt(a?.followers)}</td>
                    <td className="num">{fmt(a?.following)}</td>
                    <td className="num">{fmt(a?.post_count)}</td>
                    <td className="muted small">{a?.error || a?.extra?.note || (a ? `via ${a.stats_source}` : 'not pulled')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {profile && (
        <section className="card">
          <h3>Facts and receipts</h3>
          <p className="muted small">Every fact below quotes the page it came from. Claims the model made without a matching quote are listed separately and not shown as facts.</p>
          <ol className="facts">
            {facts.map((f) => (
              <li key={f.id}>
                <strong>[{f.id}]</strong> {f.claim} <Label value={f.label} />
                <div className="quote">“{f.quote}” <a href={f.url} target="_blank" rel="noreferrer">{hostname(f.url)}</a>{f.date ? ` · ${f.date}` : ''}</div>
              </li>
            ))}
          </ol>
          {(profile.conflicts || []).length > 0 && (
            <>
              <h4>Sources disagree</h4>
              <ul>
                {profile.conflicts.map((c, i) => (
                  <li key={i}><strong>{c.topic}:</strong> {c.sources.map((s, j) => <span key={j}>{j ? ' vs ' : ''}<a href={s.url} target="_blank" rel="noreferrer">{hostname(s.url)}</a> says “{s.says}”</span>)}. <em>{c.resolution}</em></li>
                ))}
              </ul>
            </>
          )}
          {(profile.rejected || []).length > 0 && (
            <details>
              <summary>{profile.rejected.length} claim(s) dropped for missing receipts</summary>
              <ul>{profile.rejected.map((r, i) => <li key={i}>{r.claim} <span className="muted">({r.reason})</span></li>)}</ul>
            </details>
          )}
        </section>
      )}
    </article>
  );
}

function Ownership({ own, reporting, factById }) {
  if (!own || !own.status) return null;
  const text = {
    subsidiary: `Owned by ${own.parent_company}`,
    independent_public: `Independent, publicly traded${own.ticker ? ` (${own.ticker})` : ''}`,
    independent_private: 'Independent, privately held',
    unknown: 'Ownership not confirmed',
  }[own.status];
  return (
    <div className="own">
      <strong>{text}</strong>{own.as_of ? ` as of ${own.as_of}` : ''}{' '}
      {(own.fact_ids || []).map((id) => factById[id] && <a key={id} className="cite" href={factById[id].url} target="_blank" rel="noreferrer">[{id}]</a>)}
      {reporting?.note && <div className="muted small">{reporting.note}</div>}
    </div>
  );
}

function PostPattern({ s }) {
  const p = s.post_pattern;
  if (!p) return <span className="muted small">not pulled</span>;
  const topics = Object.entries(p.by_topic || {}).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ');
  return (
    <span className="small">
      {p.own} own, {p.reposts} reposts{topics ? ` (${topics})` : ''}{p.posts_tactics ? '' : ', no tactics posts'}
      {p.latest_own && <> · <a href={p.latest_own.url} target="_blank" rel="noreferrer">latest</a></>}
    </span>
  );
}

function hostname(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } }
