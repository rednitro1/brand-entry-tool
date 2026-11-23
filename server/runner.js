import { makeFirecrawl, makeLimiter } from './providers/firecrawl.js';
import { makeClaude } from './providers/claude.js';
import { makeApollo, makeProspeo } from './providers/people.js';
import { makeApify } from './providers/apify.js';
import { resolveBrand } from './modules/resolve.js';
import { buildProfile } from './modules/profile.js';
import { findStakeholders, PERSONAS } from './modules/stakeholders.js';
import { fetchRecentPosts } from './modules/linkedinPosts.js';
import { pullPageStats } from './modules/social.js';

/* One run = resolve, then profile / stakeholders / social in parallel. Each module gets
   its own provider clients so its cost is attributable, writes its own status row, and
   can fail without stopping the others (the UI shows a labeled gap). */

export const MODULES = ['resolve', 'profile', 'stakeholders', 'social'];
const MAX_PEOPLE_WITH_POSTS = 3;

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

/* Wraps one module: status rows, log capture, cost, and error isolation. */
async function runModule(db, runId, name, fn) {
  const log = [];
  const say = (m) => { log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); };
  await db.updateModule(runId, name, { status: 'running', started_at: new Date().toISOString() });
  try {
    const { result, costUsd = 0, detail = {}, status = 'done' } = await fn(say);
    await db.updateModule(runId, name, { status, cost_usd: costUsd, detail, log, finished_at: new Date().toISOString() });
    return { ok: true, result, costUsd };
  } catch (err) {
    say(`error: ${err.message}`);
    await db.updateModule(runId, name, { status: 'failed', error: err.message.slice(0, 500), log, finished_at: new Date().toISOString() });
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
      for (const s of ranked) {
        try {
          const p = await fetchRecentPosts({ fc, profileUrl: s.linkedin_url, log });
          s.post_pattern = p.pattern;
          posts.set(s.linkedin_url, p.posts);
        } catch (err) { log(`posts failed for ${s.full_name}: ${err.message}`); }
      }
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
      const rows = await pullPageStats({ socials: brand.socials, apify, fc, log });
      for (const row of rows) await db.saveSocialAccount(brandRow.id, row);
      const failed = rows.filter((x) => x.error).length;
      return {
        result: rows,
        costUsd: sumCost(apify.usage(), fc.usage()),
        status: failed === rows.length ? 'failed' : 'done',
        detail: { platforms: rows.map((x) => ({ platform: x.platform, followers: x.followers, error: x.error })) },
      };
    }),
  ]);

  for (const x of results) costs.push(x.costUsd);
  const allOk = results.every((x) => x.ok);
  await db.finishRun(runId, { status: allOk ? 'done' : 'partial', costUsd: sumCost(...costs.map((c) => ({ costUsd: c }))) });
}

const rank = (persona) => { const i = PERSONAS.indexOf(persona); return i === -1 ? 99 : i; };
