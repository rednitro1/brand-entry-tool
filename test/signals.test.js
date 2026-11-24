import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSignals, parseDate, monthsAgo } from '../shared/signals.js';

const NOW = new Date(Date.UTC(2026, 10, 24)); // 2026-11-24

const bundle = {
  profile: {
    facts: [
      { id: 'f1', kind: 'about', claim: 'Founded in 2018.', date: '2018' },
      { id: 'f2', kind: 'acquisition', claim: 'Celsius acquired Alani Nu.', date: '2025-04-01' },
      { id: 'f3', kind: 'leadership', claim: 'JoBeth Fink became CMO.', date: '2026-08' },
      { id: 'f4', kind: 'launch', claim: 'Launched a protein line.', date: null },
      { id: 'f5', kind: 'launch', claim: "Launched Witch's Brew.", date: '2026-09-15' },
      { id: 'f6', kind: 'financial', claim: 'Net sales of $X in 2023.', date: '2023-11' },
      { id: 'f7', kind: 'other', claim: 'Has a podcast.', date: '2026-10' },
      { id: 'f8', kind: 'leadership', claim: 'John Fieldly is Chairman and CEO of Celsius Holdings.', date: '2026-11-05' },
      { id: 'f9', kind: 'acquisition', claim: 'Celsius Holdings holds complete ownership of Alani Nu as a wholly owned subsidiary.', date: '2026-03-28' },
    ],
  },
  stakeholders: [
    { full_name: 'New Hire', title: 'Director of Social', started_role_at: '2026-05-01', started_company_at: '2026-05-01' },
    { full_name: 'Promoted Person', title: 'VP Marketing', started_role_at: '2026-03-01', started_company_at: '2019-02-01' },
    { full_name: 'Long Timer', title: 'CMO', started_role_at: '2021-01-01', started_company_at: '2021-01-01' },
    { full_name: 'No Data', title: 'Head of CX', started_role_at: null },
  ],
};

test('parseDate / monthsAgo handle year, month and day precision in UTC', () => {
  assert.equal(parseDate('2026-08').toISOString().slice(0, 10), '2026-08-01');
  assert.equal(parseDate('2018').toISOString().slice(0, 10), '2018-01-01');
  assert.equal(parseDate('soon'), null);
  assert.equal(monthsAgo(parseDate('2026-05-01'), NOW), 6);
});

test('buildSignals: groups leadership, corporate, launch and financial facts; skips about/other', () => {
  const { groups } = buildSignals(bundle, NOW);
  assert.deepEqual(groups.map((g) => g.key), ['people', 'corporate', 'launch', 'financial']);
  const all = groups.flatMap((g) => g.items.map((i) => i.text));
  assert.ok(!all.includes('Founded in 2018.'));
  assert.ok(!all.includes('Has a podcast.'));
});

test('buildSignals: static leadership and ownership facts are not signals, changes are', () => {
  const texts = buildSignals(bundle, NOW).groups.flatMap((g) => g.items.map((i) => i.text));
  assert.ok(!texts.some((t) => t.startsWith('John Fieldly is Chairman')));
  assert.ok(!texts.some((t) => t.includes('holds complete ownership')));
  assert.ok(texts.includes('Celsius acquired Alani Nu.'));
  assert.ok(texts.includes('JoBeth Fink became CMO.'));
});

test('buildSignals: new seats in the last 12 months, new hire vs internal move', () => {
  const people = buildSignals(bundle, NOW).groups.find((g) => g.key === 'people').items.map((i) => i.text);
  assert.deepEqual(people, [
    'JoBeth Fink became CMO.',
    'New Hire joined as Director of Social',
    'Promoted Person moved into the role of VP Marketing',
  ], 'newest first; long-tenured and undated people are not signals');
});

test('buildSignals: newest first, undated last, old ones flagged, count skips old', () => {
  const s = buildSignals(bundle, NOW);
  const launch = s.groups.find((g) => g.key === 'launch').items;
  assert.equal(launch[0].ref.fact.id, 'f5');
  assert.equal(launch[1].date, null);
  assert.ok(launch[0].recent);
  const fin = s.groups.find((g) => g.key === 'financial').items[0];
  assert.ok(fin.older, '3-year-old result is tucked away');
  assert.equal(s.count, 6, '7 signals minus the old financial one');
});

test('buildSignals: empty research gives no groups', () => {
  assert.deepEqual(buildSignals({ profile: null, stakeholders: [] }, NOW), { groups: [], count: 0 });
});
