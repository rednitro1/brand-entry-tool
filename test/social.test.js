import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapInstagram, mapTiktok, mapX, mapLinkedin, pullPageStats } from '../server/modules/social.js';

const rec = (f) => JSON.parse(fs.readFileSync(new URL(`../fixtures/recorded/${f}`, import.meta.url)));
const ig = rec('apify-ig-profile-alani.json');
const tt = rec('apify-tiktok-profile-alani.json');
const xx = rec('apify-x-profile-alani.json');
const li = rec('orbisearch-linkedin-company-alani.json').data.alexandria[0].data;

test('mapInstagram (recorded, age-gated): counts kept, post count null, restriction noted', () => {
  const r = mapInstagram(ig, 'alaninutrition');
  assert.equal(r.followers, 1549728);
  assert.equal(r.following, 22);
  assert.equal(r.post_count, null);
  assert.equal(r.extra.restricted, true);
  assert.match(r.extra.note, /18 years old/);
});

test('mapTiktok (recorded)', () => {
  assert.deepEqual({ ...mapTiktok(tt), extra: undefined }, { followers: 1100000, following: 43, post_count: 459, extra: undefined });
});

test('mapX (recorded)', () => {
  const r = mapX(xx);
  assert.equal(r.followers, 32677);
  assert.equal(r.post_count, 26119);
});

test('mapLinkedin (recorded orbisearch)', () => {
  const r = mapLinkedin(li);
  assert.equal(r.followers, 74397);
  assert.equal(r.extra.employees, 673);
});

test('mappers throw on empty payloads instead of returning zeros', () => {
  assert.throws(() => mapInstagram([], 'x'));
  assert.throws(() => mapTiktok([{ error: 'not found' }]), /not found/);
  assert.throws(() => mapX([]));
  assert.throws(() => mapLinkedin({}));
});

const socials = {
  instagram: { handle: 'alaninutrition', url: 'https://www.instagram.com/alaninutrition/' },
  tiktok: { handle: 'alaninutrition', url: 'https://www.tiktok.com/@alaninutrition' },
  x: { handle: 'alaninutrition', url: 'https://x.com/alaninutrition' },
  linkedin: { handle: 'alani-nutrition', url: 'https://www.linkedin.com/company/alani-nutrition/' },
};
// STUB providers returning the recorded payloads.
const apify = { async run(actor) { return { 'apify~instagram-profile-scraper': ig, 'clockworks~tiktok-profile-scraper': tt, 'apidojo~twitter-user-scraper': xx }[actor]; } };
const fc = { async alexandria() { return li; } };

test('pullPageStats (stub): all four platforms', async () => {
  const rows = await pullPageStats({ socials, apify, fc });
  assert.deepEqual(rows.map((r) => [r.platform, r.followers]), [['instagram', 1549728], ['tiktok', 1100000], ['x', 32677], ['linkedin', 74397]]);
  assert.ok(rows.every((r) => r.error === null));
});

test('pullPageStats (stub): one platform failing and one missing do not block the rest', async () => {
  const flaky = { async run(actor) { if (actor.startsWith('clockworks')) throw new Error('apify run ended FAILED'); return apify.run(actor); } };
  const rows = await pullPageStats({ socials: { ...socials, x: undefined }, apify: flaky, fc });
  const by = Object.fromEntries(rows.map((r) => [r.platform, r]));
  assert.match(by.tiktok.error, /FAILED/);
  assert.match(by.x.error, /No account found/);
  assert.equal(by.instagram.followers, 1549728);
  assert.equal(by.linkedin.followers, 74397);
});
