import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaims, quoteAppears, classifySource, stripEmDashes } from '../server/evidence.js';
import { finalizeProfile, choosePages } from '../server/modules/profile.js';

// Fixture pages: one primary (wire release), one press article, one vendor blog.
const pages = [
  { url: 'https://www.businesswire.com/news/home/2025/celsius-completes-alani-nu', markdown: 'Celsius Holdings, Inc. (Nasdaq: CELH) today announced it has completed its acquisition of Alani Nu, a fast-growing functional lifestyle brand.' },
  { url: 'https://www.bevnet.com/news/2025/alani-nu-cmo', markdown: 'JoBeth Fink, previously **Chief Creative Officer**, has been named Chief Marketing Officer of Alani Nu. Founder Katy Hearn started the brand in 2018.' },
  { url: 'https://agency.example.com/case-study', markdown: 'Our agency helped Alani Nu scale a campus ambassador program to more than 300 colleges across the country.' },
  { url: 'https://news.example.org/alani', markdown: 'Celsius Holdings, Inc. (Nasdaq: CELH) today announced it has completed its acquisition of Alani Nu.' },
];

const claims = [
  { id: 'f1', claim: 'Celsius acquired Alani Nu', url: 'https://businesswire.com/news/home/2025/celsius-completes-alani-nu/', quote: 'today announced it has completed its acquisition of Alani Nu', inferred: false, vendor: false },
  { id: 'f2', claim: 'Fink is CMO', url: 'https://www.bevnet.com/news/2025/alani-nu-cmo', quote: 'JoBeth Fink, previously Chief Creative Officer, has been named Chief Marketing Officer', inferred: false, vendor: false },
  { id: 'f3', claim: '300+ campus ambassadors', url: 'https://agency.example.com/case-study', quote: 'scale a campus ambassador program to more than 300 colleges', inferred: false, vendor: true },
  { id: 'f4', claim: 'Hallucinated quote', url: 'https://www.bevnet.com/news/2025/alani-nu-cmo', quote: 'Alani Nu spends $40 million a year on creators', inferred: false, vendor: false },
  { id: 'f5', claim: 'Unfetched source', url: 'https://somewhere-else.com/x', quote: 'today announced it has completed its acquisition', inferred: false, vendor: false },
  { id: 'f6', claim: 'No URL', url: '', quote: 'anything at all here', inferred: false, vendor: false },
  { id: 'f7', claim: 'Fink replaced the prior CMO', url: 'https://www.bevnet.com/news/2025/alani-nu-cmo', quote: 'has been named Chief Marketing Officer of Alani Nu', inferred: true, vendor: false },
  { id: 'f8', claim: 'Founded 2018 per one article', url: 'https://www.bevnet.com/news/2025/alani-nu-cmo', quote: 'Founder Katy Hearn started the brand in 2018', inferred: false, vendor: false },
];

test('quoteAppears tolerates markdown emphasis, curly quotes, whitespace', () => {
  assert.ok(quoteAppears('previously Chief Creative Officer, has been named', pages[1].markdown));
  assert.ok(!quoteAppears('short', pages[1].markdown), 'too-short quotes never match');
});

test('validateClaims labels and rejects correctly', () => {
  const { accepted, rejected } = validateClaims(claims, pages, { brandDomains: ['alaninu.com'] });
  const label = Object.fromEntries(accepted.map((c) => [c.id, c.label]));
  assert.equal(label.f1, 'verified', 'wire release = primary');
  assert.equal(label.f2, 'single_source');
  assert.equal(label.f3, 'vendor_claim');
  assert.equal(label.f7, 'inferred');
  assert.equal(label.f8, 'single_source');
  const reasons = Object.fromEntries(rejected.map((c) => [c.id, c.reason]));
  assert.match(reasons.f4, /quote not found/);
  assert.match(reasons.f5, /not among the fetched/);
  assert.match(reasons.f6, /no evidence URL/);
  assert.equal(accepted.length + rejected.length, claims.length, 'every claim accounted for');
});

test('validateClaims: corroboration across domains upgrades to verified', () => {
  const { accepted } = validateClaims([{ ...claims[0], url: 'https://news.example.org/alani' }], pages, {});
  assert.equal(accepted[0].label, 'verified');
  assert.equal(accepted[0].corroborating.length, 1);
});

test('classifySource: brand site and parent IR are primary, LinkedIn is profile', () => {
  assert.equal(classifySource('https://www.alaninu.com/pages/about', { brandDomains: ['alaninu.com'] }), 'primary');
  assert.equal(classifySource('https://ir.celsiusholdingsinc.com/x', { primaryHints: ['celsiusholdingsinc.com'] }), 'primary');
  assert.equal(classifySource('https://www.linkedin.com/posts/x'), 'profile');
  assert.equal(classifySource('https://www.bevnet.com/x'), 'press');
});

test('finalizeProfile drops summary points whose facts were all rejected, and one-sided conflicts', () => {
  const raw = {
    ownership: { status: 'subsidiary', parent_company: 'Celsius Holdings', parent_domain: 'celsiusholdingsinc.com', ticker: 'CELH', as_of: '2025-04', fact_ids: ['f1'], reasoning: 'Wire release.' },
    facts: claims,
    conflicts: [
      { topic: 'Founding year', sources: [{ url: pages[1].url, says: '2018' }, { url: 'https://never-fetched.com', says: '2017' }], resolution: 'unresolved' },
      { topic: 'Name', sources: [{ url: pages[0].url, says: 'A' }, { url: pages[1].url, says: 'B' }], resolution: 'prefer primary' },
    ],
    summary_points: [
      { text: 'Alani Nu is owned by Celsius — acquired in 2025.', fact_ids: ['f1'] },
      { text: 'It spends heavily on creators.', fact_ids: ['f4'] },
    ],
  };
  const p = finalizeProfile(raw, pages, { domain: 'alaninu.com' });
  assert.equal(p.summary.length, 1);
  assert.ok(!p.summary[0].text.includes('—'), 'em dash removed');
  assert.equal(p.conflicts.length, 1, 'conflict citing an unfetched page is dropped');
  assert.equal(p.rejected.length, 3);
});

test('choosePages: dedupes, skips retailers/social, brand site first, capped', () => {
  const results = [
    { url: 'https://www.bevnet.com/a' }, { url: 'https://bevnet.com/a/' }, { url: 'https://www.amazon.com/x' },
    { url: 'https://www.instagram.com/alaninutrition/' }, { url: 'https://alaninu.com/pages/about' },
    ...Array.from({ length: 12 }, (_, i) => ({ url: `https://news${i}.com/a` })),
  ];
  const chosen = choosePages(results, { domain: 'alaninu.com' }, 8);
  assert.equal(chosen[0].url, 'https://alaninu.com/pages/about');
  assert.equal(chosen.length, 8);
  assert.equal(chosen.filter((r) => r.url.includes('bevnet')).length, 1);
});

test('stripEmDashes', () => {
  assert.equal(stripEmDashes('A — B'), 'A, B');
});
