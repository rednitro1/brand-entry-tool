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
  // Bloom's page posts, re-dated so they land inside the 90-day window whenever this runs.
  const company = rec('harvestapi-company-posts-bloom.json').data.alexandria[0].data;
  const shift = Date.now() - new Date(company.elements[0].postedAt.date).getTime() - 2 * 864e5;
  const companyNow = { ...company, elements: company.elements.map((e) => ({ ...e, postedAt: { ...e.postedAt, date: new Date(new Date(e.postedAt.date).getTime() + shift).toISOString() } })) };
  const page = (url) => `# ${url}\n\n${'Recorded page text used by the local fake mode. '.repeat(12)}`;
  const fc = () => ({
    async search(q) { await d(700, 1600); return q.startsWith('site:linkedin') ? [{ url: 'https://www.linkedin.com/company/alani-nutrition/' }] : searchRes; },
    async scrape(url, o) { await d(900, 2600); return o?.formats?.includes('links') ? { url, links } : { url, title: url, markdown: page(url) }; },
    // FAKE_PAGE_POSTS=0 simulates a brand page with no posts (the few-posts case).
    async alexandria(provider, capability) {
      await d(2000, 4500);
      if (capability === 'linkedin/company-posts') return process.env.FAKE_PAGE_POSTS === '0' ? { elements: [] } : companyNow;
      return provider === 'harvestapi' ? posts : li;
    },
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

/* Stand-in for Claude on the drafting step: picks the first three candidate posts and
   writes placeholder copy that cites real evidence ids, so the UI and validator run. */
export function makeFakeDraftClaude() {
  return {
    async structured({ system, user }) {
      await jitter(2500, 4500);
      if (/choose which recent posts/.test(system)) {
        const ids = [...new Set(user.match(/\[post:\d+\]/g) || [])].map((x) => x.slice(1, -1));
        return { parsed: { picks: ids.slice(0, 3).map((id) => ({ post_id: id, reason: 'FAKE MODE: first candidate in rank order.' })) } };
      }
      const picked = (((user.split('OTHER POSTS')[0].split('PICKED POSTS')[1]) || '').match(/\[post:\d+\]/g) || []).map((x) => x.slice(1, -1));
      // Fill each person's templates from the prompt, like a well-behaved model would.
      const blocks = user.split('PICKED POSTS')[0].split(/\n(?=\[person:\d+\])/).filter((b) => /^\[person:\d+\]/.test(b));
      const fill = (t, v) => t.replace(/\{([^}]+)\}/g, (_, k) => ({ proof_customer: 'e.l.f. Beauty', proof_result: 'cut DM reply time from 11 hours to 9 minutes' }[k] ?? v[k] ?? 'their latest launch'));
      const messages = blocks.map((b) => {
        const pid = b.match(/^\[(person:\d+)\]/)[1];
        const v = Object.fromEntries((b.match(/SLOT VALUES: (.*)/)?.[1] || '').split('; ').map((kv) => { const [k, ...r] = kv.split('='); return [k, r.join('=').replace(/ \(cite .*\)$/, '')]; }));
        const cites = ((b.match(/\(cite (proof:[^)]*)\)/) || [, ''])[1].split(', ')).filter((x) => x.startsWith('proof:'));
        const ev = ['stat:platforms', ...cites, 'proof:p4'];
        return { person_id: pid, connection: { text: fill(b.match(/CONNECTION TEMPLATE: (.*)/)[1], v), evidence: ev }, first_dm: { text: fill(b.match(/DM TEMPLATE: (.*)/)[1], v), evidence: ev } };
      });
      const tracks = [...new Set(blocks.map((b) => (b.match(/TRACK: (PDF|LOOM)/) || [, ''])[1].toLowerCase()).filter(Boolean))];
      return {
        parsed: {
          comments: picked.map((id) => ({ post_id: id, text: 'FAKE MODE comment: reacting to what this post actually says.', evidence: [id] })),
          own_post: { text: 'FAKE MODE own post. Food and beverage brands like Fishwife use Nectar to find creators, and at e.l.f. Beauty DM replies went from 11 hours to 9 minutes.', evidence: ['proof:p9', 'proof:p4'], closest_category_used: 'packaged food' },
          messages,
          outlines: tracks.map((t) => ({ track: t, bullets: [
            { text: 'FAKE MODE: how e.l.f. Beauty cut DM reply time from 11 hours to 9 minutes', evidence: ['proof:p4'] },
            { text: 'FAKE MODE: what their follower count means for daily comment and DM volume', evidence: ['stat:platforms'] },
          ] })),
          notes_for_ben: 'Fake mode: placeholder copy, no model was called.',
        },
      };
    },
    usage: () => ({ costUsd: 0, input: 0, output: 0 }),
  };
}

export function makeMemDb() {
  const t = { brands: [], runs: [], modules: [], profiles: [], people: [], posts: [], social: [], brandPosts: [], playbooks: [], drafts: [] };
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
      const brandOf = (bid) => { const b = t.brands.find((x) => x.id === bid); return b ? { name: b.name, slug: b.slug } : null; };
      const drafts = [...t.drafts].reverse().map((x) => ({ id: x.id, kind: 'draft', brand: brandOf(x.brand_id), status: x.status, cost_usd: 0, started_at: x.created_at, finished_at: x.finished_at, created_at: x.created_at, modules: [] }));
      return [...drafts, ...[...t.runs].reverse().map((r) => ({
        kind: 'run',
        id: r.id, brand: t.brands.find((b) => b.id === r.brand_id) ? { name: t.brands.find((b) => b.id === r.brand_id).name, slug: t.brands.find((b) => b.id === r.brand_id).slug } : null,
        status: r.status, cost_usd: 0, started_at: r.started_at, finished_at: r.finished_at, created_at: r.created_at,
        modules: t.modules.filter((m) => m.run_id === r.id).map((m) => ({ module: m.module, status: m.status, cost_usd: 0 })),
      }))].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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
    async spendToday() { return { spentTodayUsd: 0, activeRuns: t.runs.filter((r) => r.status === 'running').length, activeDrafts: t.drafts.filter((r) => r.status === 'running').length }; },
    async getBrandBySlug(slug) { return t.brands.find((b) => b.slug === slug) || null; },
    async saveBrandPosts(brandId, platform, posts) {
      t.brandPosts = t.brandPosts.filter((p) => !(p.brand_id === brandId && posts.some((x) => x.id === p.id)));
      t.brandPosts.push(...posts.map((p) => ({ brand_id: brandId, platform, id: p.id, url: p.url, caption: p.text, posted_at: p.posted_at, likes: p.reactions, comments: p.comments, is_repost: p.is_repost, author: p.author })));
    },
    async getPlaybook() { return t.playbooks.at(-1) || null; },
    async savePlaybook(content, note) { const row = { id: id(), content, note, created_at: now() }; t.playbooks.push(row); return row; },
    async createDraft({ brandId, model, picks = [], playbookId = null }) { const row = { id: id(), brand_id: brandId, model, status: 'running', output: {}, picks, rejected_claims: [], cost_usd: 0, playbook_id: playbookId, created_at: now(), finished_at: null, error: null }; t.drafts.push(row); return row; },
    async finishDraft(draftId, { status, output = {}, picks = [], rejected = [], costUsd = 0, error = null }) { Object.assign(t.drafts.find((x) => x.id === draftId), { status, output, picks, rejected_claims: rejected, cost_usd: costUsd, error, finished_at: now() }); },
    async getDraft(draftId) { return t.drafts.find((x) => x.id === draftId) || null; },
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
      const brandPosts = t.brandPosts.filter((p) => p.brand_id === brand.id).sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
      const draft = [...t.drafts].reverse().find((x) => x.brand_id === brand.id) || null;
      return { brand, profile, stakeholders, social, lastRun, brandPosts, draft };
    },
  };
}
