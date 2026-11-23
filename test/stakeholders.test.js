import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyPersona, pickReveals, tenureFromHistory, normLinkedin, stakeholderFromApollo, findStakeholders,
} from '../server/modules/stakeholders.js';
import { makeProspeo } from '../server/providers/people.js';

const rec = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/recorded/${f}`, import.meta.url)));
const domainRows = rec('apollo-search-alani.json').people;
const keywordRows = rec('apollo-search-keyword-alani.json').people;
const kira = rec('apollo-match-kira.json').person;

test('classifyPersona: the four wedge personas, team, and exclusions', () => {
  assert.equal(classifyPersona('Chief Marketing Officer'), 'cmo');
  assert.equal(classifyPersona('CMO, Alani Nu'), 'cmo');
  assert.equal(classifyPersona('Chief Digital Officer'), 'chief_digital');
  assert.equal(classifyPersona('Director of Social Media, Influencer, and Collegiate Marketing'), 'director_social');
  assert.equal(classifyPersona('Head of Community'), 'director_social');
  assert.equal(classifyPersona('Director of Consumer Experience'), 'director_cx');
  assert.equal(classifyPersona('VP, Customer Care'), 'director_cx');
  assert.equal(classifyPersona('Associate Manager, Social Media Marketing'), 'team_social');
  assert.equal(classifyPersona('Customer Support Manager - Alani Nu'), 'team_social');
  assert.equal(classifyPersona('Social Media Intern'), null);
  assert.equal(classifyPersona('Creative Director, Brand Lead (Alani Nu)'), null, 'creative is not a wedge persona');
  assert.equal(classifyPersona(''), null);
});

test('pickReveals (recorded): Kira first, dedupe, cap respected, non-personas skipped', () => {
  const picks = pickReveals([...domainRows, ...keywordRows, domainRows[0]], { maxReveals: 4 });
  assert.equal(picks.length, 4);
  assert.equal(picks[0].first_name, 'Kira');
  assert.equal(picks[0].persona, 'director_social');
  assert.equal(new Set(picks.map((p) => p.id)).size, 4, 'no duplicate reveals');
  assert.ok(!picks.some((p) => /Creative Director/.test(p.title)));
});

test('pickReveals: wedge personas outrank team members under a tight cap', () => {
  const rows = [
    { id: '1', title: 'Social Media Coordinator' }, { id: '2', title: 'Community Manager' },
    { id: '3', title: 'Chief Marketing Officer' }, { id: '4', title: 'Director of Customer Experience' },
  ];
  assert.deepEqual(pickReveals(rows, { maxReveals: 2 }).map((p) => p.id), ['3', '4']);
});

test('tenureFromHistory (recorded Kira): role since 2025-10, company since 2021-03 across brand + parent rows', () => {
  const t = tenureFromHistory(kira.employment_history, { title: kira.title, orgNames: ['Alani Nu', 'alaninu', 'Celsius Holdings'], now: new Date('2026-11-22') });
  assert.equal(t.started_role_at, '2025-10-01');
  assert.equal(t.started_company_at, '2021-03-01');
  assert.equal(t.tenure_months, 13);
  assert.equal(t.company_tenure_months, 68);
});

test('tenureFromHistory: no history -> nulls, not zeros', () => {
  assert.deepEqual(tenureFromHistory([], { title: 'CMO' }), { started_role_at: null, started_company_at: null, tenure_months: null, company_tenure_months: null });
});

test('normLinkedin canonicalises http/www/trailing junk', () => {
  assert.equal(normLinkedin('http://www.linkedin.com/in/kira-lazzarini'), 'https://www.linkedin.com/in/kira-lazzarini/');
  assert.equal(normLinkedin('https://linkedin.com/in/JoBethFink?trk=x'), 'https://www.linkedin.com/in/jobethfink/');
  assert.equal(normLinkedin('https://www.linkedin.com/company/alani-nu/'), null);
});

test('stakeholderFromApollo (recorded): title verbatim from the record, labeled single_source', () => {
  const s = stakeholderFromApollo(kira, 'director_social', { orgNames: ['Alani Nu', 'Celsius'] });
  assert.equal(s.full_name, 'Kira Lazzarini');
  assert.equal(s.title, 'Director of Social Media, Influencer, and Collegiate Marketing');
  assert.equal(s.linkedin_url, 'https://www.linkedin.com/in/kira-lazzarini/');
  assert.equal(s.verification, 'single_source');
});

// STUB clients built from the recorded responses.
function stubApollo({ rows = { domain: domainRows, keyword: keywordRows }, matchFails = new Set() } = {}) {
  const calls = { search: 0, match: 0 };
  return {
    calls,
    async search(p) { calls.search++; return p.q_organization_domains_list ? rows.domain : rows.keyword; },
    async match(id) {
      calls.match++;
      if (matchFails.has(id)) throw new Error('apollo match 500');
      const row = [...rows.domain, ...rows.keyword].find((r) => r.id === id);
      if (row.first_name === 'Kira') return kira;
      return { name: `${row.first_name} X`, title: row.title, linkedin_url: `https://www.linkedin.com/in/${row.first_name.toLowerCase()}-x`, employment_history: [] };
    },
  };
}
function stubProspeo(results) {
  const calls = { search: 0 };
  return { calls, async search() { calls.search++; return results; } };
}

test('findStakeholders (stub): Apollo finds social; missing CMO/CDO/CX triggers Prospeo; gaps reported', async () => {
  const apollo = stubApollo();
  const prospeo = stubProspeo([
    { person: { full_name: 'Jacob A. Campbell', current_job_title: 'Creative Director Media', linkedin_url: 'https://www.linkedin.com/in/jacob-a-campbell-42212312' }, company: { domain: 'alaninu.com' } },
    { person: { full_name: 'Pat Example', current_job_title: 'Chief Marketing Officer', linkedin_url: 'https://www.linkedin.com/in/pat-example' }, company: { domain: 'alaninu.com' } },
  ]);
  const r = await findStakeholders({ brand: { name: 'Alani Nu', domain: 'alaninu.com' }, apollo, prospeo, maxReveals: 6 });
  assert.equal(apollo.calls.search, 2);
  assert.ok(apollo.calls.match <= 6);
  assert.equal(prospeo.calls.search, 1);
  assert.equal(r.coverage.director_social, true);
  assert.equal(r.coverage.cmo, true, 'Prospeo filled the CMO');
  assert.ok(!r.stakeholders.some((s) => s.full_name.startsWith('Jacob')), 'non-persona Prospeo rows dropped');
  assert.deepEqual(r.gaps.map((g) => g.persona).sort(), ['chief_digital', 'director_cx']);
});

test('findStakeholders (stub): a failed match is logged and skipped, run continues', async () => {
  const logs = [];
  const apollo = stubApollo({ matchFails: new Set([domainRows[0].id]) });
  const r = await findStakeholders({ brand: { name: 'Alani Nu', domain: 'alaninu.com' }, apollo, prospeo: stubProspeo([]), log: (m) => logs.push(m) });
  assert.ok(logs.some((l) => /apollo match failed for Kira/.test(l)));
  assert.equal(r.coverage.director_social, false);
  assert.equal(r.gaps.length, 4);
});

test('findStakeholders (stub): all personas covered by Apollo -> Prospeo never called', async () => {
  const rows = { domain: [
    { id: 'a', first_name: 'A', title: 'Chief Marketing Officer' }, { id: 'b', first_name: 'B', title: 'Chief Digital Officer' },
    { id: 'c', first_name: 'C', title: 'Director of Social Media' }, { id: 'd', first_name: 'D', title: 'Director of Consumer Experience' },
  ], keyword: [] };
  const prospeo = stubProspeo([]);
  const r = await findStakeholders({ brand: { name: 'X', domain: 'x.com' }, apollo: stubApollo({ rows }), prospeo });
  assert.equal(prospeo.calls.search, 0);
  assert.equal(r.gaps.length, 0);
});

test('prospeo client: NO_RESULTS is empty and free; rate limit retried', async () => {
  const replies = [
    { ok: false, status: 429, json: async () => ({ error: true, error_code: 'Rate limit exceeded' }) },
    { ok: false, status: 400, json: async () => ({ error: true, error_code: 'NO_RESULTS' }) },
  ];
  const p = makeProspeo('k', { fetchImpl: async () => replies.shift(), sleep: async () => {} });
  assert.deepEqual(await p.search({}), []);
  assert.equal(p.usage().credits, 0);
});
