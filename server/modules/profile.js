import { z } from 'zod';
import { validateClaims, hostOf, urlKey, stripEmDashes } from '../evidence.js';

/* Brand profile: who they are, what they do, recent changes (acquisitions, launches,
   leadership moves). Firecrawl finds and fetches sources; Claude extracts claims, each
   with a verbatim quote; evidence.js keeps only the claims whose quote is really on the
   cited page. Summary points survive only if a fact behind them survived. */

const MAX_PAGES = 10;
const MAX_CHARS_PER_PAGE = 14_000;

export const ProfileSchema = z.object({
  parent_company: z.string().nullable().describe('Owner/parent company if a source states one, else null'),
  parent_domain: z.string().nullable().describe('Parent company website domain if stated in a source, e.g. celsiusholdingsinc.com, else null'),
  facts: z.array(z.object({
    id: z.string().describe('f1, f2, ...'),
    claim: z.string().describe('One factual statement, plain language'),
    kind: z.enum(['about', 'acquisition', 'launch', 'leadership', 'financial', 'other']),
    date: z.string().nullable().describe('YYYY-MM-DD or YYYY-MM if the source states it, else null'),
    url: z.string().describe('Exact URL of the source page this came from, copied from the SOURCE header'),
    quote: z.string().describe('Verbatim sentence or phrase copied character-for-character from that page that supports the claim'),
    inferred: z.boolean().describe('true if the claim is an inference from wording rather than stated outright'),
    vendor: z.boolean().describe('true if the source is a vendor/agency/third party promoting its own work with the brand'),
  })),
  conflicts: z.array(z.object({
    topic: z.string(),
    sources: z.array(z.object({ url: z.string(), says: z.string() })),
    resolution: z.string().describe('Which source to prefer and why (primary over secondary), or "unresolved"'),
  })),
  summary_points: z.array(z.object({
    text: z.string().describe('One sentence for the brand summary'),
    fact_ids: z.array(z.string()).describe('ids of the facts this sentence rests on'),
  })),
});

const SYSTEM = `You research consumer brands for a B2B sales team. You extract facts ONLY from the source pages provided.
Rules:
- Every fact must cite exactly one provided SOURCE url and include a verbatim quote copied from that page. Never paraphrase inside "quote".
- If sources disagree (names, titles, dates, who replaced whom), record a conflict with both URLs. Prefer the company's own releases and filings over articles and notes.
- Mark inferences (e.g. a seat swap implied by press-release wording) with inferred=true.
- Mark claims from vendors/agencies promoting their own work with the brand vendor=true.
- Titles of people must be quoted exactly as the source writes them.
- If something is not in the sources, leave it out. Do not use outside knowledge.
- Do not use em dashes.`;

/* The first live Alani Nu run missed the newest leadership move and the latest quarter:
   generic queries rank older, better-linked pages first. The dated queries below pull
   current-year news and earnings releases (which also name the parent company). */
export function profileQueries(brand, year = new Date().getFullYear()) {
  const n = brand.name;
  return [
    { q: `${n} brand founded company about`, limit: 5 },
    { q: `${n} acquisition OR acquired OR "parent company"`, limit: 5 },
    { q: `${n} launch OR new flavor OR new product ${year}`, limit: 5 },
    { q: `${n} "chief marketing officer" OR CMO OR "head of social" appointed`, limit: 5 },
    { q: `${n} named chief marketing officer ${year}`, limit: 5 },
    { q: `${n} net sales quarter results ${year}`, limit: 5 },
  ];
}

/* Choose which pages to fetch: dedupe, skip retailers and social sites, keep the brand's
   own site first, and cap the count so a run's cost is bounded. */
export function choosePages(results, brand, max = MAX_PAGES) {
  const skip = /amazon\.|target\.com|walmart\.com|gnc\.com|vitaminshoppe\.com|instagram\.com|tiktok\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|reddit\.com|pinterest\./;
  const seen = new Set();
  const own = [];
  const rest = [];
  for (const r of results) {
    const k = urlKey(r.url);
    if (seen.has(k) || skip.test(hostOf(r.url))) continue;
    seen.add(k);
    (brand.domain && hostOf(r.url).endsWith(brand.domain) ? own : rest).push(r);
  }
  return [...own.slice(0, 2), ...rest].slice(0, max);
}

export function buildSourcesPrompt(brand, pages) {
  const blocks = pages.map((p, i) => {
    const text = p.markdown.length > MAX_CHARS_PER_PAGE ? `${p.markdown.slice(0, MAX_CHARS_PER_PAGE)}\n[... page truncated at ${MAX_CHARS_PER_PAGE} chars]` : p.markdown;
    return `=== SOURCE ${i + 1} ===\nURL: ${p.url}\nTITLE: ${p.title || ''}\n${text}`;
  });
  return `Brand: ${brand.name}${brand.domain ? ` (official site ${brand.domain})` : ''}\nToday: ${new Date().toISOString().slice(0, 10)}\n\n${blocks.join('\n\n')}\n\nExtract the brand profile facts, conflicts and summary points.`;
}

/* Pure post-processing, separated so it's testable against fixtures. */
export function finalizeProfile(raw, pages, brand) {
  const brandDomains = [brand.domain].filter(Boolean);
  const primaryHints = [raw.parent_domain].filter(Boolean).map((d) => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
  const { accepted, rejected } = validateClaims(raw.facts, pages, { brandDomains, primaryHints });
  const ok = new Set(accepted.map((f) => f.id));
  const summary = raw.summary_points
    .filter((s) => s.fact_ids.some((id) => ok.has(id)))
    .map((s) => ({ text: stripEmDashes(s.text), fact_ids: s.fact_ids.filter((id) => ok.has(id)) }));
  const fetched = new Set(pages.map((p) => urlKey(p.url)));
  const conflicts = raw.conflicts
    .map((c) => ({ ...c, sources: c.sources.filter((s) => fetched.has(urlKey(s.url))) }))
    .filter((c) => c.sources.length >= 2);
  return {
    parent_company: raw.parent_company,
    summary,
    facts: accepted.map((f) => ({ ...f, claim: stripEmDashes(f.claim) })),
    rejected,
    conflicts,
    sources: pages.map((p) => ({ url: p.url, title: p.title, kind: brandDomains.some((d) => hostOf(p.url).endsWith(d)) ? 'primary' : 'other' })),
  };
}

export async function buildProfile({ brand, fc, claude, log = () => {} }) {
  const results = [];
  for (const { q, limit } of profileQueries(brand)) {
    try { results.push(...await fc.search(q, { limit })); } catch (err) { log(`search failed (${q}): ${err.message}`); }
  }
  if (brand.siteUrl) results.unshift({ url: brand.siteUrl, title: `${brand.name} official site` });
  const chosen = choosePages(results, brand);
  log(`${results.length} search results -> fetching ${chosen.length} pages`);

  const pages = [];
  await Promise.all(chosen.map(async (r) => {
    try {
      const p = await fc.scrape(r.url, { formats: ['markdown'] });
      if (p.markdown && p.markdown.length > 200) pages.push({ url: r.url, title: p.title || r.title, markdown: p.markdown, publishedAt: p.publishedAt });
      else log(`skipped thin page: ${r.url}`);
    } catch (err) { log(`fetch failed ${r.url}: ${err.message}`); }
  }));
  if (pages.length === 0) throw new Error('No readable sources found for this brand.');
  const truncated = pages.filter((p) => p.markdown.length > MAX_CHARS_PER_PAGE).length;
  if (truncated) log(`${truncated} long page(s) truncated to ${MAX_CHARS_PER_PAGE} chars for the model`);

  const { parsed } = await claude.structured({ system: SYSTEM, user: buildSourcesPrompt(brand, pages), schema: ProfileSchema, effort: 'medium' });
  const profile = finalizeProfile(parsed, pages, brand);
  log(`facts: ${profile.facts.length} kept, ${profile.rejected.length} rejected (no receipt); conflicts: ${profile.conflicts.length}`);
  return profile;
}
