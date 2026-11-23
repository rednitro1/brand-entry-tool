import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseInput, pickOfficialSite, extractSocialLinks, slugify, resolveBrand } from '../server/modules/resolve.js';
import { cleanUrl } from '../server/providers/firecrawl.js';

const recordedSearch = JSON.parse(fs.readFileSync(new URL('../fixtures/recorded/firecrawl-search-alani.json', import.meta.url)));
const recordedLinks = JSON.parse(fs.readFileSync(new URL('../fixtures/recorded/firecrawl-scrape-alani-links.json', import.meta.url)));
const searchResults = recordedSearch.data.web.map((r) => ({ ...r, url: cleanUrl(r.url) }));

test('parseInput: name, LinkedIn URL, rejects other URLs and empty', () => {
  assert.deepEqual(parseInput('  Alani Nu '), { kind: 'name', name: 'Alani Nu' });
  const li = parseInput('https://www.linkedin.com/company/alani-nu/about/');
  assert.equal(li.kind, 'linkedin');
  assert.equal(li.linkedinSlug, 'alani-nu');
  assert.equal(li.name, 'Alani Nu');
  assert.throws(() => parseInput('https://alaninu.com'));
  assert.throws(() => parseInput('linkedin.com/in/kira-lazzarini'));
  assert.throws(() => parseInput('   '));
});

test('slugify handles accents, ampersands, punctuation', () => {
  assert.equal(slugify('Alani Nu'), 'alani-nu');
  assert.equal(slugify("Ben & Jerry's"), 'ben-and-jerry-s');
  assert.equal(slugify('Crème Brûlée Co.'), 'creme-brulee-co');
});

test('cleanUrl strips Google tracking params', () => {
  assert.equal(cleanUrl('https://www.alaninu.com/?srsltid=abc&utm_source=x'), 'https://www.alaninu.com/');
});

test('pickOfficialSite (recorded): picks alaninu.com, skips retailers', () => {
  assert.deepEqual(pickOfficialSite(searchResults, 'Alani Nu'), { domain: 'alaninu.com', url: 'https://alaninu.com/' });
});

test('pickOfficialSite: only retailers -> null, never a retailer page', () => {
  const retailers = searchResults.filter((r) => !r.url.includes('alaninu.com'));
  assert.equal(pickOfficialSite(retailers, 'Alani Nu'), null);
});

test('extractSocialLinks (recorded): real handles from the footer, no LinkedIn on site', () => {
  const s = extractSocialLinks(recordedLinks.data.links);
  assert.equal(s.instagram.handle, 'alaninutrition');
  assert.equal(s.tiktok.handle, 'alaninutrition');
  assert.equal(s.x.handle, 'alaninutrition');
  assert.equal(s.linkedin, undefined);
});

test('extractSocialLinks: ignores post/share links, majority handle wins', () => {
  const s = extractSocialLinks([
    'https://www.instagram.com/p/ABC123/',
    'https://www.instagram.com/brand/',
    'https://www.instagram.com/brand',
    'https://www.instagram.com/somecreator/',
    'https://twitter.com/intent/tweet?text=hi',
    'https://www.linkedin.com/company/brand-co/',
  ]);
  assert.equal(s.instagram.handle, 'brand');
  assert.equal(s.x, undefined);
  assert.equal(s.linkedin.handle, 'brand-co');
});

// STUB Firecrawl client fed by recorded responses: exercises the orchestration offline.
function stubFc({ liResults = [{ url: 'https://www.linkedin.com/company/alani-nu/', title: 'Alani Nu | LinkedIn' }] } = {}) {
  const calls = [];
  return {
    calls,
    async search(q) { calls.push(['search', q]); return q.startsWith('site:linkedin') ? liResults : searchResults; },
    async scrape(url) { calls.push(['scrape', url]); return { url, links: recordedLinks.data.links }; },
  };
}

test('resolveBrand (stub): name input -> site socials + LinkedIn via search labeled single_source', async () => {
  const fc = stubFc();
  const b = await resolveBrand({ input: 'Alani Nu', fc });
  assert.equal(b.domain, 'alaninu.com');
  assert.equal(b.socials.instagram.handle, 'alaninutrition');
  assert.equal(b.linkedinUrl, 'https://www.linkedin.com/company/alani-nu/');
  assert.equal(b.socials.linkedin.label, 'single_source');
  assert.equal(fc.calls.length, 3);
});

test('resolveBrand (stub): LinkedIn URL input skips the LinkedIn search', async () => {
  const fc = stubFc();
  const b = await resolveBrand({ input: 'https://www.linkedin.com/company/alani-nu/', fc });
  assert.equal(b.socials.linkedin.source, 'user_input');
  assert.equal(fc.calls.filter(([, q]) => String(q).startsWith('site:linkedin')).length, 0);
});

test('resolveBrand (stub): no LinkedIn found -> linkedinUrl null, no crash', async () => {
  const b = await resolveBrand({ input: 'Alani Nu', fc: stubFc({ liResults: [] }) });
  assert.equal(b.linkedinUrl, null);
});
