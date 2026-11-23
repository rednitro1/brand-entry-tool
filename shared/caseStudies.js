/* Relevant case studies for an account: the Playbook's proof library grouped by
   customer and ranked by how close that customer is to the account's industry. Pure and
   free (no AI call); shared by the browser and the tests. */

const INDUSTRIES = [
  { key: 'beverage', family: 'food and beverage', words: ['beverage', 'drink', 'energy drink', 'soda', 'sparkling', 'hydration', 'pre-workout', 'caffeine', 'coffee', 'tea', 'water', 'juice', 'canned drink'] },
  { key: 'packaged food', family: 'food and beverage', words: ['food', 'snack', 'protein bar', 'seafood', 'tinned', 'canned fish', 'protein bar', 'cereal', 'chips'] },
  { key: 'beauty', family: 'beauty', words: ['beauty', 'cosmetic', 'skincare', 'skin care', 'makeup', 'lipstick', 'fragrance', 'haircare', 'hair care', 'nail', 'lash'] },
  { key: 'accessories / DTC', family: 'accessories', words: ['leather', 'bag', 'apparel', 'fashion', 'clothing', 'accessories', 'jewelry', 'footwear', 'shoe'] },
];

/* The account's industry from its own research text (name, summary, facts). Returns
   { key, hits } or null when nothing matches. */
export function detectIndustry(bundle) {
  const text = [
    bundle?.brand?.name,
    ...(bundle?.profile?.summary || []).map((s) => s.text),
    ...(bundle?.profile?.facts || []).map((f) => f.claim),
  ].join(' ').toLowerCase();
  let best = null;
  for (const ind of INDUSTRIES) {
    // Whole words only (plural allowed): "tea" must not match "team".
    const hits = ind.words.reduce((n, w) => n + (text.match(new RegExp(`\\b${w.replace(/[-/]/g, '\\$&')}s?\\b`, 'g')) || []).length, 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { key: ind.key, family: ind.family, hits };
  }
  return best;
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
export const sameIndustry = (a, b) => { const wb = words(b); return words(a).some((w) => wb.includes(w)); };
const familyOf = (category) => INDUSTRIES.find((i) => sameIndustry(i.key, category))?.family || null;
/* Same family but a different industry, e.g. packaged food next to a beverage account. */
export const adjacentIndustry = (a, b) => !sameIndustry(a, b) && Boolean(familyOf(a)) && familyOf(a) === familyOf(b);

/* One entry per customer: its results and quotes, whether it is in the account's
   industry, and a source link. Same industry first, then customers with numbers. */
export function rankCaseStudies(proof = [], industry = null) {
  const byCustomer = new Map();
  for (const p of proof) {
    if (p.kind === 'company' || !p.customer?.trim()) continue;
    const c = byCustomer.get(p.customer) || { customer: p.customer, category: p.category, items: [], source_url: '' };
    c.items.push(p);
    if (!c.source_url && p.source_url) c.source_url = p.source_url;
    // Prefer the customer's own story page over the shared customers page.
    if (p.source_url && /\/customers\/[a-z0-9-]+\/?$/i.test(p.source_url)) c.source_url = p.source_url;
    byCustomer.set(p.customer, c);
  }
  return [...byCustomer.values()]
    .map((c) => {
      const results = c.items.filter((p) => p.kind === 'result');
      const match = industry ? sameIndustry(c.category, industry) : false;
      const adjacent = industry ? adjacentIndustry(c.category, industry) : false;
      return { ...c, match, adjacent, results, quotes: c.items.filter((p) => p.kind === 'quote'), score: (match ? 100 : adjacent ? 50 : 0) + results.length * 10 + c.items.length };
    })
    .sort((a, b) => b.score - a.score);
}

/* Nectar-wide numbers (kind 'company'), shown under the customer stories. */
export const companyWide = (proof = []) => proof.filter((p) => p.kind === 'company');
