import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIndustry, rankCaseStudies, companyWide } from '../shared/caseStudies.js';
import { SEED_PLAYBOOK } from '../server/playbook.js';

test('detectIndustry: reads the account industry from its research text', () => {
  const bloom = { brand: { name: 'Bloom Nutrition' }, profile: { summary: [{ text: 'Bloom sells Sparkling Energy drinks and greens powders.' }], facts: [{ claim: 'Bloom launched a protein line.' }] } };
  assert.equal(detectIndustry(bloom).key, 'food and beverage');
  const elf = { brand: { name: 'e.l.f.' }, profile: { summary: [{ text: 'Affordable makeup and skincare.' }], facts: [] } };
  assert.equal(detectIndustry(elf).key, 'beauty');
  assert.equal(detectIndustry({ brand: { name: 'Acme' }, profile: null }), null);
});

test('rankCaseStudies: same-industry customers first, then customers with numbers; company-wide kept apart', () => {
  const food = rankCaseStudies(SEED_PLAYBOOK.proof, 'food and beverage');
  assert.ok(food.slice(0, 4).every((c) => c.match), 'the 4 food and beverage customers lead');
  assert.deepEqual(food.slice(0, 4).map((c) => c.customer).sort(), ['David Protein', 'Fishwife', 'Liquid Death', 'OLIPOP']);
  assert.ok(!food.some((c) => c.customer.startsWith('Nectar')));
  assert.equal(food[4].customer, 'e.l.f. Beauty', 'then the customer with the most results');
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
