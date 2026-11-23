import fs from 'node:fs';
import crypto from 'node:crypto';

/* LOCAL DEV ONLY (FAKE_MODE=1, refused in production): an in-memory database and
   recorded provider responses with artificial delays, so the live run UI (progress bar,
   log, switching tabs mid-run, refreshing) can be exercised without spending API credits
   or writing to the real Supabase project. */

const rec = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/recorded/${f}`, import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => sleep(lo + Math.random() * (hi - lo));

export function makeFakeProviders({ speed = 1 } = {}) {
  const d = (lo, hi) => jitter(lo * speed, hi * speed);
  const searchRes = rec('firecrawl-search-alani.json').data.web;
  const links = rec('firecrawl-scrape-alani-links.json').data.links;
  const kira = rec('apollo-match-kira.json').person;
  const posts = rec('harvestapi-posts-kira.json').data.alexandria[0].data;
  const li = rec('orbisearch-linkedin-company-alani.json').data.alexandria[0].data;
  const page = (url) => `# ${url}\n\n${'Recorded page text used by the local fake mode. '.repeat(12)}`;
  const fc = () => ({
    async search(q) { await d(700, 1600); return q.startsWith('site:linkedin') ? [{ url: 'https://www.linkedin.com/company/alani-nutrition/' }] : searchRes; },
    async scrape(url, o) { await d(900, 2600); return o?.formats?.includes('links') ? { url, links } : { url, title: url, markdown: page(url) }; },
    async alexandria(provider) { await d(2000, 4500); return provider === 'harvestapi' ? posts : li; },
    usage: () => ({ costUsd: 0 }),
  });
  return {
    firecrawl: fc,
    claude: () => ({
      async structured() {
        await d(6000, 9000);
        return { parsed: { ownership: { status: 'unknown', parent_company: null, parent_domain: null, ticker: null, as_of: null, fact_ids: [], reasoning: 'fake mode' }, facts: [], conflicts: [], summary_points: [] } };
      },
      usage: () => ({ costUsd: 0 }),
    }),
    apollo: () => ({
      async search(p) { await d(800, 1500); return p.q_organization_domains_list ? rec('apollo-search-alani.json').people : []; },
      async match(id) { await d(600, 1200); return id === '60ed4dad0c9382000153d773' ? kira : null; },
      usage: () => ({ costUsd: 0 }),
    }),
    prospeo: () => ({ async search() { await d(1000, 2000); return []; }, usage: () => ({ costUsd: 0 }) }),
    apify: () => ({
      async run(actor) {
        await d(4000, 12000);
        return { 'apify~instagram-profile-scraper': rec('apify-ig-profile-alani.json'), 'clockworks~tiktok-profile-scraper': rec('apify-tiktok-profile-alani.json'), 'apidojo~twitter-user-scraper': rec('apify-x-profile-alani.json') }[actor];
      },
      usage: () => ({ costUsd: 0 }),
    }),
  };
}

export function makeMemDb() {
  const t = { brands: [], runs: [], modules: [], profiles: [], people: [], posts: [], social: [] };
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  return {
    async upsertBrand(b) {
      let row = t.brands.find((x) => x.slug === b.slug);
      const fields = { slug: b.slug, name: b.name, domain: b.domain || null, linkedin_url: b.linkedinUrl || null, socials: b.socials || {}, gaps: b.gaps || [], is_example: false, updated_at: now() };
      if (row) Object.assign(row, fields); else { row = { id: id(), created_at: now(), ...fields }; t.brands.push(row); }
      return row;
    },
    async listBrands() {
      return t.brands.map((b) => ({
        slug: b.slug, name: b.name, domain: b.domain, is_example: false, updated_at: b.updated_at, owner: null,
        wedge_count: t.people.filter((p) => p.brand_id === b.id && p.persona !== 'team_social').length,
        people_count: t.people.filter((p) => p.brand_id === b.id).length,
        running: t.runs.some((r) => r.brand_id === b.id && r.status === 'running'),
      }));
    },
    async listRuns() {
      return [...t.runs].reverse().map((r) => ({
        id: r.id, brand: t.brands.find((b) => b.id === r.brand_id) ? { name: t.brands.find((b) => b.id === r.brand_id).name, slug: t.brands.find((b) => b.id === r.brand_id).slug } : null,
        status: r.status, cost_usd: 0, started_at: r.started_at, finished_at: r.finished_at, created_at: r.created_at,
        modules: t.modules.filter((m) => m.run_id === r.id).map((m) => ({ module: m.module, status: m.status, cost_usd: 0 })),
      }));
    },
    async createRun({ input, modules }) {
      const run = { id: id(), input, status: 'running', brand_id: null, cost_usd: 0, started_at: now(), finished_at: null, created_at: now(), error: null };
      t.runs.push(run);
      for (const m of modules) t.modules.push({ run_id: run.id, module: m, status: 'queued', progress: 0, log: [], cost_usd: 0 });
      return run;
    },
    async setRunBrand(runId, brandId) { t.runs.find((r) => r.id === runId).brand_id = brandId; },
    async updateModule(runId, module, patch) { Object.assign(t.modules.find((m) => m.run_id === runId && m.module === module), patch); },
    async finishRun(runId, { status, costUsd, error = null }) { Object.assign(t.runs.find((r) => r.id === runId), { status, cost_usd: costUsd, error, finished_at: now() }); },
    async getRun(runId) {
      const run = t.runs.find((r) => r.id === runId);
      if (!run) return null;
      const b = t.brands.find((x) => x.id === run.brand_id);
      return { ...run, brand: b ? { slug: b.slug, name: b.name } : null, modules: t.modules.filter((m) => m.run_id === runId).map((m) => ({ ...m, log: [...m.log] })) };
    },
    async spendToday() { return { spentTodayUsd: 0, activeRuns: t.runs.filter((r) => r.status === 'running').length }; },
    async failOrphanedRuns() {},
    async saveProfile(brandId, runId, p) { t.profiles.push({ id: id(), brand_id: brandId, run_id: runId, created_at: now(), ...p }); },
    async saveStakeholders(brandId, runId, list) {
      const rows = list.map((s) => ({ id: id(), brand_id: brandId, run_id: runId, created_at: now(), ...s }));
      t.people.push(...rows);
      return rows;
    },
    async saveStakeholderPosts(sid, posts) { t.posts.push(...posts.map((p) => ({ stakeholder_id: sid, ...p }))); },
    async saveSocialAccount(brandId, a) { t.social = t.social.filter((x) => !(x.brand_id === brandId && x.platform === a.platform)); t.social.push({ id: id(), brand_id: brandId, ...a }); },
    async getBrandBundle(slug) {
      const brand = t.brands.find((b) => b.slug === slug);
      if (!brand) return null;
      const profile = [...t.profiles].reverse().find((p) => p.brand_id === brand.id) || null;
      const lastPeopleRun = [...t.people].reverse().find((p) => p.brand_id === brand.id)?.run_id;
      const stakeholders = t.people.filter((p) => p.brand_id === brand.id && p.run_id === lastPeopleRun)
        .map((p) => ({ ...p, stakeholder_posts: t.posts.filter((x) => x.stakeholder_id === p.id) }));
      const social = t.social.filter((s) => s.brand_id === brand.id);
      const lastRun = [...t.runs].reverse().find((r) => r.brand_id === brand.id) || null;
      return { brand, profile, stakeholders, social, lastRun };
    },
  };
}
