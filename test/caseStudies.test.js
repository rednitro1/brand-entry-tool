import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIndustry, rankCaseStudies, companyWide } from '../shared/caseStudies.js';
import { SEED_PLAYBOOK } from '../server/playbook.js';

test('detectIndustry: reads the account industry from its research text', () => {
  const bloom = { brand: { name: 'Bloom Nutrition' }, profile: { summary: [{ text: 'Bloom sells Sparkling Energy drinks and greens powders.' }], facts: [{ claim: 'Bloom launched a protein line.' }] } };
  assert.equal(detectIndustry(bloom).key, 'beverage');
  const elf = { brand: { name: 'e.l.f.' }, profile: { summary: [{ text: 'Affordable makeup and skincare.' }], facts: [] } };
  assert.equal(detectIndustry(elf).key, 'beauty');
  assert.equal(detectIndustry({ brand: { name: 'Acme' }, profile: null }), null);
});

test('rankCaseStudies: same-industry customers first, then customers with numbers; company-wide kept apart', () => {
  const bev = rankCaseStudies(SEED_PLAYBOOK.proof, 'beverage');
  assert.deepEqual(bev.slice(0, 2).map((c) => c.customer).sort(), ['Liquid Death', 'OLIPOP'], 'same-space beverage customers lead');
  assert.ok(bev.slice(0, 2).every((c) => c.match));
  assert.deepEqual(bev.slice(2, 4).map((c) => c.customer).sort(), ['David Protein', 'Fishwife'], 'then adjacent packaged food');
  assert.ok(bev.slice(2, 4).every((c) => c.adjacent && !c.match));
  assert.ok(!bev.some((c) => c.customer.startsWith('Nectar')));
  assert.equal(bev[4].customer, 'e.l.f. Beauty', 'then the customer with the most results');
  const beauty = rankCaseStudies(SEED_PLAYBOOK.proof, 'beauty');
  assert.equal(beauty[0].customer, 'e.l.f. Beauty');
  assert.equal(companyWide(SEED_PLAYBOOK.proof).length, 1);
});

test('rankCaseStudies: prefers a customer\'s own story page as the source link', () => {
  const r = rankCaseStudies([
    { customer: 'e.l.f. Beauty', category: 'beauty', kind: 'result', claim: 'a', source_url: 'https://www.nectarsocial.com/customers/' },
    { customer: 'e.l.f. Beauty', category: 'beauty', kind: 'result', claim: 'b', source_url: 'https://www.nectarsocial.com/customers/elf-beauty/' },
  ], 'beauty');
  assert.equal(r[0].source_url, 'https://www.nectarsocial.com/customers/elf-beauty/');
  assert.equal(r[0].results.length, 2);
});
