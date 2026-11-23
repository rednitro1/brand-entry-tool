import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeRun, MODULES } from '../server/runner.js';

const rec = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/recorded/${f}`, import.meta.url)));

// In-memory STUB db that records every write.
function memDb() {
  const s = { modules: {}, run: null, brands: [], profiles: [], people: [], posts: [], social: [], brandPosts: [] };
  return {
    s,
    async updateModule(_r, m, patch) { s.modules[m] = { ...(s.modules[m] || {}), ...patch }; },
    async finishRun(_r, x) { s.run = x; },
    async upsertBrand(b) { s.brands.push(b); return { id: 'brand-1', ...b }; },
    async setRunBrand() {},
    async saveProfile(_b, _r, p) { s.profiles.push(p); },
    async saveStakeholders(_b, _r, list) { s.people.push(...list); return list.map((x, i) => ({ id: `p${i}`, linkedin_url: x.linkedin_url })); },
    async saveStakeholderPosts(id, posts) { s.posts.push([id, posts.length]); },
    async saveSocialAccount(_b, a) { s.social.push(a); },
    async saveBrandPosts(_b, platform, posts) { s.brandPosts.push(...posts.map((p) => ({ platform, ...p }))); },
  };
}

const searchRes = rec('firecrawl-search-alani.json').data.web;
const links = rec('firecrawl-scrape-alani-links.json').data.links;
const kira = rec('apollo-match-kira.json').person;
const postsPayload = rec('harvestapi-posts-kira.json').data.alexandria[0].data;
const liStats = rec('orbisearch-linkedin-company-alani.json').data.alexandria[0].data;
const companyPosts = rec('harvestapi-company-posts-bloom.json').data.alexandria[0].data;

// STUB providers: recorded payloads, no network.
function stubProviders({ profileThrows = false } = {}) {
  const fc = () => ({
    async search(q) { return q.startsWith('site:linkedin') ? [{ url: 'https://www.linkedin.com/company/alani-nutrition/' }] : searchRes; },
    async scrape(url) { return { url, links, markdown: '' }; },
    async alexandria(provider, capability) { return capability === 'linkedin/company-posts' ? companyPosts : provider === 'harvestapi' ? postsPayload : liStats; },
    usage: () => ({ costUsd: 0.01 }),
  });
  return {
    firecrawl: fc,
    claude: () => ({ async structured() { throw new Error('not called'); }, usage: () => ({ costUsd: 0 }) }),
    apollo: () => ({
      async search(p) { return p.q_organization_domains_list ? rec('apollo-search-alani.json').people : []; },
      async match(id) { return id === '60ed4dad0c9382000153d773' ? kira : null; },
      usage: () => ({ costUsd: 0.02 }),
    }),
    prospeo: () => ({ async search() { return []; }, usage: () => ({ costUsd: 0 }) }),
    apify: () => ({
      async run(actor) { return { 'apify~instagram-profile-scraper': rec('apify-ig-profile-alani.json'), 'clockworks~tiktok-profile-scraper': rec('apify-tiktok-profile-alani.json'), 'apidojo~twitter-user-scraper': rec('apify-x-profile-alani.json') }[actor]; },
      usage: () => ({ costUsd: 0.03 }),
    }),
    profileThrows,
  };
}

test('executeRun (stub): profile fails (no readable pages), the rest finish, run is partial', async () => {
  const db = memDb();
  await executeRun({ db, runId: 'r1', input: 'Alani Nu', providers: stubProviders() });
  assert.deepEqual(Object.keys(db.s.modules).sort(), [...MODULES].sort());
  assert.equal(db.s.modules.resolve.status, 'done');
  assert.equal(db.s.modules.profile.status, 'failed', 'stub pages are empty, so profile has no sources');
  assert.match(db.s.modules.profile.error, /No readable sources/);
  assert.equal(db.s.modules.stakeholders.status, 'done');
  assert.equal(db.s.modules.social.status, 'done');
  assert.equal(db.s.run.status, 'partial');
  assert.ok(db.s.run.costUsd > 0);
});

test('executeRun (stub): stakeholders saved with posts pattern for Kira', async () => {
  const db = memDb();
  await executeRun({ db, runId: 'r2', input: 'Alani Nu', providers: stubProviders() });
  const k = db.s.people.find((p) => p.full_name === 'Kira Lazzarini');
  assert.ok(k);
  assert.equal(k.post_pattern.own, 4);
  assert.deepEqual(db.s.posts, [['p0', 9]]);
  assert.equal(db.s.social.length, 4);
  assert.equal(db.s.social.find((x) => x.platform === 'linkedin').followers, 74397);
});

test('executeRun (stub): resolve fails -> other modules skipped, run failed', async () => {
  const db = memDb();
  await executeRun({ db, runId: 'r3', input: 'https://example.com/not-linkedin', providers: stubProviders() });
  assert.equal(db.s.modules.resolve.status, 'failed');
  assert.equal(db.s.modules.profile.status, 'skipped');
  assert.equal(db.s.run.status, 'failed');
});

test('executeRun (stub): every module ends with progress 1 and plain-English log lines', async () => {
  const db = memDb();
  await executeRun({ db, runId: 'r9', input: 'Alani Nu', providers: stubProviders() });
  for (const m of MODULES) assert.equal(db.s.modules[m].progress, 1, `${m} progress`);
  const all = MODULES.flatMap((m) => db.s.modules[m].log || []);
  assert.ok(all.every((l) => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /.test(l)), 'every line is timestamped');
  assert.ok(all.some((l) => l.includes('Found Kira Lazzarini, Director of Social Media') && l.includes('(wedge persona: Director of Social)')));
  assert.ok(all.some((l) => l.includes('LinkedIn @alani-nutrition: 74,397 followers')));
  assert.ok(!all.some((l) => /@\S+\.(com|co)\b/.test(l) && l.includes('email')), 'no emails in the log');
});

test('executeRun (stub): brand LinkedIn page posts are saved with the run', async () => {
  const db = memDb();
  await executeRun({ db, runId: 'r10', input: 'Alani Nu', providers: stubProviders() });
  assert.equal(db.s.brandPosts.length, 50);
  assert.ok(db.s.brandPosts.every((p) => p.platform === 'linkedin' && p.url));
  assert.equal(db.s.modules.social.detail.page_posts, 50);
});
