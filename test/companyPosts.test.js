import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapCompanyPost, fetchCompanyPosts, withinDays } from '../server/modules/linkedinPosts.js';

const data = JSON.parse(fs.readFileSync(new URL('../fixtures/recorded/harvestapi-company-posts-bloom.json', import.meta.url))).data.alexandria[0].data;

test('mapCompanyPost (recorded Bloom page): text, date, engagement, author', () => {
  const p = mapCompanyPost(data.elements[0]);
  assert.match(p.text, /Woolworths/);
  assert.equal(p.posted_at, '2026-11-18T23:01:36.239Z');
  assert.equal(p.reactions, 126);
  assert.equal(p.comments, 8);
  assert.equal(p.author, 'Bloom Nutrition');
  assert.equal(p.is_repost, false);
  assert.ok(p.id && p.url.includes('linkedin.com/posts/'));
});

test('mapCompanyPost: a repost is flagged', () => {
  const reposts = data.elements.map(mapCompanyPost).filter((p) => p.is_repost);
  assert.ok(reposts.length >= 1);
  assert.ok(reposts.some((p) => /TikTok Shop/.test(p.text)));
});

test('fetchCompanyPosts: maps every element and logs the 3-month count', async () => {
  const lines = [];
  const fc = { async alexandria(provider, cap, opts) { assert.equal(cap, 'linkedin/company-posts'); assert.match(opts.company, /bloom-nutrition-llc/); return data; } };
  const posts = await fetchCompanyPosts({ fc, companyUrl: 'https://www.linkedin.com/company/bloom-nutrition-llc/', name: 'Bloom', log: (l) => lines.push(l) });
  assert.equal(posts.length, 50);
  assert.match(lines[0], /^Bloom LinkedIn page: 50 recent posts, \d+ in the last 3 months$/);
});

test('withinDays: 90-day window, future dates and missing dates excluded', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.equal(withinDays('2026-09-01T00:00:00Z', 90, now), true);
  assert.equal(withinDays('2026-08-01T00:00:00Z', 90, now), false);
  assert.equal(withinDays('2026-12-01T00:00:00Z', 90, now), false);
  assert.equal(withinDays(null, 90, now), false);
});
