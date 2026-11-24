import { makeFirecrawl, makeLimiter } from './providers/firecrawl.js';
import { makeClaude } from './providers/claude.js';
import { makeApollo, makeProspeo } from './providers/people.js';
import { makeApify } from './providers/apify.js';
import { resolveBrand } from './modules/resolve.js';
import { buildProfile } from './modules/profile.js';
import { findStakeholders, PERSONAS } from './modules/stakeholders.js';
import { fetchRecentPosts, fetchCompanyPosts, withinDays } from './modules/linkedinPosts.js';
import { pullPageStats } from './modules/social.js';

/* One run = resolve, then profile / stakeholders / social in parallel. Each module gets
   its own provider clients so its cost is attributable, writes its own status row, and
   can fail without stopping the others (the UI shows a labeled gap). */

export const MODULES = ['resolve', 'profile', 'stakeholders', 'social'];
const MAX_PEOPLE_WITH_POSTS = 12; // every stakeholder, with a safety cap (about half a cent each)

export function defaultProviders(env = process.env) {
  const limiter = makeLimiter(3); // one Firecrawl account: share its rate limit across modules
  return {
    firecrawl: () => makeFirecrawl(env.FIRECRAWL_API_KEY, { limiter }),
    claude: () => makeClaude(env.ANTHROPIC_API_KEY),
    apollo: () => makeApollo(env.APOLLO_API_KEY),
    prospeo: () => makeProspeo(env.PROSPEO_API_KEY),
    apify: () => makeApify(env.APIFY_TOKEN),
  };
}

const sumCost = (...usages) => Math.round(usages.reduce((s, u) => s + Number(u?.costUsd || 0), 0) * 10000) / 10000;

const MAX_LOG_LINES = 300;
const FLUSH_MS = 1000;

/* Log lines are shown to anyone viewing the run, so they describe what the tool is doing
   in plain words. Belt and braces: anything that looks like a credential is masked and
   long provider messages are cut. */
export function scrubLine(msg) {
  return String(msg)
    .replace(/([?&](token|key|api_key|apikey)=)[^&\s]+/gi, '$1***')
    .replace(/\b(sk|sb_secret|fc|apify_api)[-_][A-Za-z0-9_-]{8,}/g, '***')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

/* A module's live logger: say(msg) adds a line, say.progress(0..1) moves the module's bar.
   Both are written to run_modules at most once a second while the module runs, so a
   viewer polling the run sees lines as they happen. Progress only moves forward. */
export function makeLiveLog({ db, runId, name, flushMs = FLUSH_MS, now = () => new Date(), write = (patch) => db.updateModule(runId, name, patch) }) {
  const lines = [];
  let progress = 0;
  let timer = null;
  let inflight = Promise.resolve();
  const flush = () => {
    timer = null;
    const patch = { log: lines.slice(), progress };
    inflight = inflight.then(() => write(patch)).catch(() => {}); // a missed flush only delays lines
    return inflight;
  };
  const schedule = () => { if (!timer) timer = setTimeout(flush, flushMs); };
  const say = (msg) => {
    if (lines.length >= MAX_LOG_LINES) return;
    lines.push(`${now().toISOString()} ${scrubLine(msg)}`);
    schedule();
  };
  say.progress = (p) => {
    const v = Math.max(0, Math.min(0.99, Number(p) || 0));
    if (v > progress) { progress = v; schedule(); }
  };
  /* Stop the timer and wait for any write in flight, so a late flush can't overwrite the
     final row with an older, shorter log. */
  const close = async () => { if (timer) clearTimeout(timer); timer = null; await inflight; return lines.slice(); };
  return { say, close, lines };
}

/* Wraps one module: status rows, live log, cost, and error isolation. */
async function runModule(db, runId, name, fn) {
  const live = makeLiveLog({ db, runId, name });
  await db.updateModule(runId, name, { status: 'running', progress: 0, started_at: new Date().toISOString() });
  try {
    const { result, costUsd = 0, detail = {}, status = 'done' } = await fn(live.say);
    const log = await live.close();
    await db.updateModule(runId, name, { status, cost_usd: costUsd, detail, log, progress: 1, finished_at: new Date().toISOString() });
    return { ok: true, result, costUsd };
  } catch (err) {
    live.say(`Stopped: ${err.message}`);
    const log = await live.close();
    await db.updateModule(runId, name, { status: 'failed', error: err.message.slice(0, 500), log, progress: 1, finished_at: new Date().toISOString() });
    return { ok: false, error: err.message, costUsd: 0 };
  }
}

export async function executeRun({ db, runId, input, providers = defaultProviders() }) {
  const costs = [];
  const r = await runModule(db, runId, 'resolve', async (log) => {
    const fc = providers.firecrawl();
    const brand = await resolveBrand({ input, fc, log });
    const costUsd = fc.usage().costUsd;
    return { result: brand, costUsd, detail: { domain: brand.domain, socials: Object.keys(brand.socials) } };
  });
  costs.push(r.costUsd);
  if (!r.ok) {
    for (const m of MODULES.slice(1)) await db.updateModule(runId, m, { status: 'skipped', error: 'Brand could not be resolved.' });
    await db.finishRun(runId, { status: 'failed', costUsd: sumCost({ costUsd: r.costUsd }), error: r.error });
    return;
  }
  const brand = r.result;
  const brandRow = await db.upsertBrand(brand);
  await db.setRunBrand(runId, brandRow.id);

  const results = await Promise.all([
    runModule(db, runId, 'profile', async (log) => {
      const fc = providers.firecrawl(); const claude = providers.claude();
      const profile = await buildProfile({ brand, fc, claude, log });
      log('Saving brand profile');
      const cost = { firecrawl: fc.usage(), claude: claude.usage() };
      await db.saveProfile(brandRow.id, runId, { ...profile, cost });
      return { result: profile, costUsd: sumCost(cost.firecrawl, cost.claude), detail: { facts: profile.facts.length, rejected: profile.rejected.length, ownership: profile.ownership.status } };
    }),

    runModule(db, runId, 'stakeholders', async (log) => {
      const apollo = providers.apollo(); const prospeo = providers.prospeo(); const fc = providers.firecrawl();
      const { stakeholders, coverage, gaps } = await findStakeholders({ brand, apollo, prospeo, log });
      // Recent public posts for the top few wedge-persona people only (cost cap).
      const ranked = [...stakeholders].sort((a, b) => rank(a.persona) - rank(b.persona)).slice(0, MAX_PEOPLE_WITH_POSTS);
      const posts = new Map();
      if (ranked.length) log(`Reading recent LinkedIn posts for all ${ranked.length} people`);
      let done = 0;
      // Parallel; the shared Firecrawl limiter keeps it inside the rate limit.
      await Promise.all(ranked.map(async (s) => {
        try {
          const p = await fetchRecentPosts({ fc, profileUrl: s.linkedin_url, name: s.full_name, log });
          s.post_pattern = p.pattern;
          posts.set(s.linkedin_url, p.posts);
          if (!p.posts.some((x) => withinDays(x.posted_at))) log(`${s.full_name}: no posts in the last 3 months`);
        } catch (err) { log(`Couldn't read posts for ${s.full_name}: ${err.message}`); }
        log.progress?.(0.6 + 0.35 * (++done / ranked.length));
      }));
      log('Saving stakeholders');
      const saved = await db.saveStakeholders(brandRow.id, runId, stakeholders);
      for (const row of saved) if (posts.has(row.linkedin_url)) await db.saveStakeholderPosts(row.id, posts.get(row.linkedin_url));
      await db.upsertBrand({ ...brand, gaps });
      return {
        result: stakeholders,
        costUsd: sumCost(apollo.usage(), prospeo.usage(), fc.usage()),
        detail: { people: stakeholders.length, coverage, gaps: gaps.map((g) => g.persona) },
      };
    }),

    runModule(db, runId, 'social', async (log) => {
      const apify = providers.apify(); const fc = providers.firecrawl();
      const [rows, pagePosts] = await Promise.all([
        pullPageStats({ socials: brand.socials, apify, fc, log }),
        brand.socials?.linkedin?.url
          ? (log(`Reading ${brand.name}'s LinkedIn page posts`),
            fetchCompanyPosts({ fc, companyUrl: brand.socials.linkedin.url, name: brand.name, log })
              .catch((err) => { log(`Couldn't read ${brand.name}'s LinkedIn page posts, continuing with a gap: ${err.message}`); return null; }))
          : Promise.resolve(null),
      ]);
      log('Saving page stats');
      for (const row of rows) await db.saveSocialAccount(brandRow.id, row);
      if (pagePosts) await db.saveBrandPosts(brandRow.id, 'linkedin', pagePosts);
      const failed = rows.filter((x) => x.error).length;
      return {
        result: rows,
        costUsd: sumCost(apify.usage(), fc.usage()),
        status: failed === rows.length ? 'failed' : 'done',
        detail: { platforms: rows.map((x) => ({ platform: x.platform, followers: x.followers, error: x.error })), page_posts: pagePosts ? pagePosts.length : null },
      };
    }),
  ]);

  for (const x of results) costs.push(x.costUsd);
  const allOk = results.every((x) => x.ok);
  await db.finishRun(runId, { status: allOk ? 'done' : 'partial', costUsd: sumCost(...costs.map((c) => ({ costUsd: c }))) });
}

const rank = (persona) => { const i = PERSONAS.indexOf(persona); return i === -1 ? 99 : i; };
